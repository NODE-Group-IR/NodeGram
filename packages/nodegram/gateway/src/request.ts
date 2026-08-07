import {
  BOT_ALIAS_RE,
  DANGEROUS_KEYS,
  MAX_JSON_DEPTH,
  MAX_JSON_KEYS,
  MAX_STRING_LENGTH,
  METHOD_RE,
  type ErrorCode,
  type RelayEnvelope,
} from "./domain.js";

export interface NormalizedHeaders {
  get(name: string): string | undefined;
  getAll(name: string): string[];
  raw: Record<string, string | string[] | undefined>;
}

export function normalizeHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): NormalizedHeaders {
  const map = new Map<string, string[]>();
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
      const existing = map.get(lower) ?? [];
      existing.push(...values);
      map.set(lower, existing);
    }
  }
  return {
    raw: headers ?? {},
    get(name: string): string | undefined {
      const values = map.get(name.toLowerCase());
      return values?.[0];
    },
    getAll(name: string): string[] {
      return map.get(name.toLowerCase()) ?? [];
    },
  };
}

export type ParseFailure = { ok: false; code: ErrorCode; message?: string };
export type ParseSuccess = { ok: true; envelope: RelayEnvelope };
export type ParseResult = ParseFailure | ParseSuccess;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateParamsValue(value: unknown, depth: number, keyCount: { n: number }): boolean {
  if (depth > MAX_JSON_DEPTH) {
    return false;
  }
  if (value === null) {
    return true;
  }
  const t = typeof value;
  if (t === "boolean" || t === "number") {
    return Number.isFinite(value as number) || t === "boolean";
  }
  if (t === "string") {
    return (value as string).length <= MAX_STRING_LENGTH;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_KEYS) {
      return false;
    }
    for (const item of value) {
      if (!validateParamsValue(item, depth + 1, keyCount)) {
        return false;
      }
    }
    return true;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    keyCount.n += keys.length;
    if (keyCount.n > MAX_JSON_KEYS) {
      return false;
    }
    for (const key of keys) {
      if (DANGEROUS_KEYS.has(key)) {
        return false;
      }
      if (key.length > 256) {
        return false;
      }
      if (!validateParamsValue(value[key], depth + 1, keyCount)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function validateRelayEnvelope(body: unknown): ParseResult {
  if (!isPlainObject(body)) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  // Reject unexpected top-level dangerous keys
  for (const key of Object.keys(body)) {
    if (DANGEROUS_KEYS.has(key)) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
  }

  const { bot, method, params } = body;

  if (typeof bot !== "string" || !BOT_ALIAS_RE.test(bot)) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  if (typeof method !== "string" || !METHOD_RE.test(method)) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  let resolvedParams: Record<string, unknown> = {};
  if (params !== undefined) {
    if (!isPlainObject(params)) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
    const keyCount = { n: 0 };
    if (!validateParamsValue(params, 0, keyCount)) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
    resolvedParams = params;
  }

  return {
    ok: true,
    envelope: { bot, method, params: resolvedParams },
  };
}

export function decodeRawBody(
  body: string | undefined,
  isBase64Encoded: boolean | undefined,
): { ok: true; bytes: Buffer } | { ok: false; code: ErrorCode } {
  if (body === undefined || body === "") {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  try {
    if (isBase64Encoded) {
      const bytes = Buffer.from(body, "base64");
      // Detect clearly invalid base64 that collapses to empty incorrectly
      if (bytes.length === 0 && body.replace(/=+$/, "").length > 0) {
        return { ok: false, code: "INVALID_REQUEST" };
      }
      return { ok: true, bytes };
    }
    return { ok: true, bytes: Buffer.from(body, "utf8") };
  } catch {
    return { ok: false, code: "INVALID_REQUEST" };
  }
}

export function parseJsonObject(bytes: Buffer): ParseResult {
  let text: string;
  try {
    text = bytes.toString("utf8");
  } catch {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  return validateRelayEnvelope(parsed);
}

export function contentTypeIsJson(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }
  const media = contentType.split(";")[0]?.trim().toLowerCase();
  return media === "application/json";
}

/**
 * Parse query string for health=1 without inventing a full query parser dependency.
 */
export function queryHasHealth(queryString: string | undefined): boolean {
  if (!queryString) {
    return false;
  }
  const q = queryString.startsWith("?") ? queryString.slice(1) : queryString;
  for (const part of q.split("&")) {
    const [rawKey, rawVal] = part.split("=");
    if (rawKey === "health" && (rawVal === "1" || rawVal === "true")) {
      return true;
    }
  }
  return false;
}

export function trustworthyContentLength(headerValue: string | undefined): number | undefined {
  if (headerValue === undefined) {
    return undefined;
  }
  if (!/^\d{1,10}$/.test(headerValue)) {
    return undefined;
  }
  return Number.parseInt(headerValue, 10);
}
