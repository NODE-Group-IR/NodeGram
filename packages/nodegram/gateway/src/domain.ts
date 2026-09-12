/** Stable error codes returned in NodeGram error envelopes. */
export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR"
  | "BAD_GATEWAY"
  | "GATEWAY_TIMEOUT";

export interface NodeGramErrorBody {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
  };
}

export interface RelayEnvelope {
  /** Telegram bot token supplied by the caller on every request. */
  token: string;
  method: string;
  params: Record<string, unknown>;
}

export interface ClientConfig {
  id: string;
  keyDigests: Buffer[];
  bots: ReadonlyMap<string, string>;
  enabled: boolean;
}

export interface GatewayConfig {
  schemaVersion: 1;
  clients: readonly ClientConfig[];
}

export interface RuntimeSettings {
  maxBodyBytes: number;
  requestTimeoutMs: number;
  allowedOrigins: readonly string[];
  burst: number;
  refillPerSecond: number;
  /** When true, completion logs may include numeric Telegram bot id (never the token secret). */
  logBotId: boolean;
  buildId: string | undefined;
  rateLimitEnabled: boolean;
}

export const SERVICE_NAME = "nodegram";
export const SERVICE_VERSION = "1.1.1";

export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";

export const BOT_ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const METHOD_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
export const KEY_PREFIX = "ng_live_";
export const HASH_HEX_RE = /^[a-f0-9]{64}$/;
/** Telegram bot tokens: digits:alphanumeric/_- (shape check only). */
export const BOT_TOKEN_RE = /^[0-9]{5,15}:[A-Za-z0-9_-]{20,100}$/;

export const DEFAULT_MAX_BODY_BYTES = 750 * 1024; // 750 KiB
export const HARD_MAX_BODY_BYTES = 900 * 1024; // 900 KiB ceiling
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
export const TIMEOUT_SAFETY_MARGIN_MS = 1_500;
export const MAX_RESPONSE_BODY_BYTES = 900 * 1024;

export const MAX_JSON_DEPTH = 32;
export const MAX_JSON_KEYS = 256;
export const MAX_STRING_LENGTH = 65_536;
export const MAX_CLIENTS = 64;
export const MAX_BOTS_PER_CLIENT = 32;
export const MAX_CONFIG_DECODED_BYTES = 256 * 1024;
export const MAX_BEARER_TOKEN_LENGTH = 256;

export const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_REQUEST: "Invalid request",
  UNAUTHORIZED: "Invalid or missing client credentials",
  METHOD_NOT_ALLOWED: "Method not allowed",
  PAYLOAD_TOO_LARGE: "Request payload too large",
  UNSUPPORTED_MEDIA_TYPE: "Unsupported media type",
  RATE_LIMITED: "Rate limit exceeded",
  CONFIGURATION_ERROR: "Service configuration error",
  INTERNAL_ERROR: "Internal server error",
  BAD_GATEWAY: "Invalid or unavailable upstream response",
  GATEWAY_TIMEOUT: "Upstream request timed out",
};

export const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  CONFIGURATION_ERROR: 500,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  GATEWAY_TIMEOUT: 504,
};
