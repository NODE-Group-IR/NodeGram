import {
  BOT_ALIAS_RE,
  BOT_TOKEN_RE,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  HARD_MAX_BODY_BYTES,
  HASH_HEX_RE,
  MAX_BOTS_PER_CLIENT,
  MAX_CLIENTS,
  MAX_CONFIG_DECODED_BYTES,
  type ClientConfig,
  type GatewayConfig,
  type RuntimeSettings,
} from "./domain.js";

export type ConfigLoadResult =
  { ok: true; config: GatewayConfig; coldStart: boolean } | { ok: false; reason: string };

let cachedConfig: GatewayConfig | undefined;
let cachedFromEnv: string | undefined;

export function resetConfigCacheForTests(): void {
  cachedConfig = undefined;
  cachedFromEnv = undefined;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  // Buffer / TypedArray cannot be frozen with elements; leave digests mutable only in place.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return value;
  }
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value as object)) {
    const child = (value as Record<string | symbol, unknown>)[key];
    if (child !== null && typeof child === "object") {
      deepFreeze(child);
    }
  }
  return value;
}

function parseKeyDigests(raw: unknown): Buffer[] | null {
  const values: string[] = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : typeof raw === "string"
      ? [raw]
      : [];

  if (values.length < 1 || values.length > 2) {
    return null;
  }

  const digests: Buffer[] = [];
  const seen = new Set<string>();
  for (const hex of values) {
    if (!HASH_HEX_RE.test(hex) || seen.has(hex)) {
      return null;
    }
    seen.add(hex);
    digests.push(Buffer.from(hex, "hex"));
  }
  return digests;
}

function parseBots(raw: unknown): Map<string, string> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length < 1 || entries.length > MAX_BOTS_PER_CLIENT) {
    return null;
  }
  const bots = new Map<string, string>();
  for (const [alias, token] of entries) {
    if (!BOT_ALIAS_RE.test(alias) || typeof token !== "string" || !BOT_TOKEN_RE.test(token)) {
      return null;
    }
    if (bots.has(alias)) {
      return null;
    }
    bots.set(alias, token);
  }
  return bots;
}

export function validateClientsDocument(decoded: unknown): GatewayConfig | null {
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    return null;
  }
  const doc = decoded as Record<string, unknown>;
  if (doc.schemaVersion !== 1) {
    return null;
  }
  if (!Array.isArray(doc.clients) || doc.clients.length < 1 || doc.clients.length > MAX_CLIENTS) {
    return null;
  }

  const clients: ClientConfig[] = [];
  const seenIds = new Set<string>();

  for (const item of doc.clients) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(c.id)) {
      return null;
    }
    if (seenIds.has(c.id)) {
      return null;
    }
    seenIds.add(c.id);

    const digests = parseKeyDigests(c.keySha256);
    if (!digests) {
      return null;
    }

    const bots = parseBots(c.bots);
    if (!bots) {
      return null;
    }

    if (typeof c.enabled !== "boolean") {
      return null;
    }

    clients.push({
      id: c.id,
      keyDigests: digests,
      bots,
      enabled: c.enabled,
    });
  }

  return deepFreeze({ schemaVersion: 1 as const, clients });
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): ConfigLoadResult {
  const raw = env.NODEGRAM_CLIENTS_B64;
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "MISSING_CLIENTS_B64" };
  }

  if (cachedConfig && cachedFromEnv === raw) {
    return { ok: true, config: cachedConfig, coldStart: false };
  }

  let decodedBytes: Buffer;
  try {
    decodedBytes = Buffer.from(raw, "base64");
  } catch {
    return { ok: false, reason: "INVALID_BASE64" };
  }

  if (decodedBytes.length === 0 || decodedBytes.length > MAX_CONFIG_DECODED_BYTES) {
    return { ok: false, reason: "CONFIG_SIZE" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodedBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "INVALID_JSON" };
  }

  const config = validateClientsDocument(parsed);
  if (!config) {
    return { ok: false, reason: "VALIDATION_FAILED" };
  }

  cachedConfig = config;
  cachedFromEnv = raw;
  return { ok: true, config, coldStart: true };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return n;
}

export function loadRuntimeSettings(env: NodeJS.ProcessEnv = process.env): RuntimeSettings {
  let maxBodyBytes = parsePositiveInt(env.NODEGRAM_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
  if (maxBodyBytes === 0) {
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES;
  }
  maxBodyBytes = Math.min(maxBodyBytes, HARD_MAX_BODY_BYTES);

  let requestTimeoutMs = parsePositiveInt(
    env.NODEGRAM_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
  if (requestTimeoutMs === 0) {
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
  }
  requestTimeoutMs = Math.min(requestTimeoutMs, 28_000);

  const allowedOrigins = (env.NODEGRAM_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^https:\/\/[^/\s]+$/.test(s));

  const burst = parsePositiveInt(env.NODEGRAM_BURST, 30);
  const refillPerSecond = Number.parseFloat(env.NODEGRAM_REFILL_PER_SECOND ?? "5");
  const refill = Number.isFinite(refillPerSecond) && refillPerSecond >= 0 ? refillPerSecond : 5;

  const rateLimitDisabled =
    env.NODEGRAM_RATE_LIMIT === "off" ||
    env.NODEGRAM_RATE_LIMIT === "0" ||
    env.NODEGRAM_RATE_LIMIT === "false" ||
    burst === 0;

  return {
    maxBodyBytes,
    requestTimeoutMs,
    allowedOrigins,
    burst: burst === 0 ? 0 : Math.max(1, burst),
    refillPerSecond: refill,
    logBotAlias: env.NODEGRAM_LOG_BOT_ALIAS === "true",
    buildId: env.NODEGRAM_BUILD_ID || undefined,
    rateLimitEnabled: !rateLimitDisabled,
  };
}
