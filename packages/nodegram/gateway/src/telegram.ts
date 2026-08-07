import {
  MAX_RESPONSE_BODY_BYTES,
  TELEGRAM_API_ORIGIN,
  TIMEOUT_SAFETY_MARGIN_MS,
  type ErrorCode,
} from "./domain.js";

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

    const rawText = await response.text();
    const byteLength = Buffer.byteLength(rawText, "utf8");
    if (byteLength > MAX_RESPONSE_BODY_BYTES) {
      return { ok: false, code: "BAD_GATEWAY", durationMs: Date.now() - started };
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText);
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
