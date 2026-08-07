import {
  MAX_RESPONSE_BODY_BYTES,
  TELEGRAM_API_ORIGIN,
  TIMEOUT_SAFETY_MARGIN_MS,
  type ErrorCode,
} from "./domain.js";
import { trustworthyContentLength } from "./request.js";

export interface TelegramCallInput {
  botToken: string;
  method: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  remainingMs: number;
  fetchImpl?: typeof fetch;
}

export type TelegramCallResult =
  | {
      ok: true;
      status: number;
      body: unknown;
      retryAfter: string | undefined;
      durationMs: number;
    }
  | {
      ok: false;
      code: Extract<ErrorCode, "BAD_GATEWAY" | "GATEWAY_TIMEOUT">;
      durationMs: number;
    };

/** Completion-log outcome for a successfully received Telegram HTTP response. */
export function telegramUpstreamOutcome(status: number): string {
  if (status >= 200 && status < 300) {
    return "TELEGRAM_OK";
  }
  if (status === 429) {
    return "TELEGRAM_RATE_LIMITED";
  }
  if (status >= 500 && status <= 599) {
    return "TELEGRAM_SERVER_ERROR";
  }
  return "TELEGRAM_CLIENT_ERROR";
}

export function computeUpstreamTimeout(configuredMs: number, remainingMs: number): number {
  const cappedByDeadline = Math.max(1, remainingMs - TIMEOUT_SAFETY_MARGIN_MS);
  return Math.min(configuredMs, cappedByDeadline);
}

/**
 * Build the Telegram Bot API URL. Origin and path shape are fixed;
 * method and token are only interpolated after validation/resolution.
 */
export function buildTelegramUrl(botToken: string, method: string): string {
  // Tokens and methods are pre-validated; still reject path separators defensively.
  if (botToken.includes("/") || botToken.includes("?") || botToken.includes("#")) {
    throw new Error("INVALID_TOKEN_SHAPE");
  }
  if (method.includes("/") || method.includes("?") || method.includes("#")) {
    throw new Error("INVALID_METHOD_SHAPE");
  }
  return `${TELEGRAM_API_ORIGIN}/bot${botToken}/${method}`;
}

function parseRetryAfter(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  // Allow integer seconds or HTTP-date-like short strings; bound length.
  if (value.length > 64) {
    return undefined;
  }
  if (/^\d{1,8}$/.test(value)) {
    return value;
  }
  // Reject characters that could break headers when re-emitted
  if (/^[\w\-:,.= ]{1,64}$/.test(value)) {
    return value;
  }
  return undefined;
}

/**
 * Read an upstream body with a hard byte cap.
 * Rejects early when Content-Length exceeds the limit; otherwise enforces the
 * limit while streaming so oversized payloads are not fully buffered first.
 */
export async function readLimitedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = trustworthyContentLength(response.headers.get("content-length") ?? undefined);
  if (declared !== undefined && declared > maxBytes) {
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {
        // best-effort cancel
      }
    }
    return { ok: false };
  }

  if (!response.body) {
    const rawText = await response.text();
    if (Buffer.byteLength(rawText, "utf8") > maxBytes) {
      return { ok: false };
    }
    return { ok: true, text: rawText };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    return { ok: false };
  }

  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

export async function callTelegram(input: TelegramCallInput): Promise<TelegramCallResult> {
  const started = Date.now();
  const timeoutMs = computeUpstreamTimeout(input.timeoutMs, input.remainingMs);
  const url = buildTelegramUrl(input.botToken, input.method);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(input.params),
      redirect: "error",
      signal: controller.signal,
    });

    const limited = await readLimitedResponseBody(response, MAX_RESPONSE_BODY_BYTES);
    if (!limited.ok) {
      return { ok: false, code: "BAD_GATEWAY", durationMs: Date.now() - started };
    }

    let body: unknown;
    try {
      body = JSON.parse(limited.text);
    } catch {
      return { ok: false, code: "BAD_GATEWAY", durationMs: Date.now() - started };
    }

    if (body === null || typeof body !== "object") {
      return { ok: false, code: "BAD_GATEWAY", durationMs: Date.now() - started };
    }

    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));

    return {
      ok: true,
      status: response.status,
      body,
      retryAfter,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, code: "GATEWAY_TIMEOUT", durationMs };
    }
    // Includes TypeError from redirect:error, DNS failures, network errors
    return { ok: false, code: "BAD_GATEWAY", durationMs };
  } finally {
    clearTimeout(timer);
  }
}
