import { randomUUID } from "node:crypto";
import { anonymizeClientId, authenticateClient, parseBearerAuthorization } from "./auth.js";
import { loadGatewayConfig, loadRuntimeSettings } from "./config.js";
import { corsEnabled, corsHeaders, isOriginAllowed } from "./cors.js";
import { SERVICE_NAME, SERVICE_VERSION, type ErrorCode } from "./domain.js";
import { getSharedRateLimiter } from "./limits.js";
import { writeCompletionLog, writeConfigErrorLog } from "./logger.js";
import {
  contentTypeIsJson,
  decodeRawBody,
  normalizeHeaders,
  parseJsonObject,
  queryHasHealth,
  trustworthyContentLength,
} from "./request.js";
import { jsonResponse, nodegramError, telegramPassthrough } from "./response.js";
import { callTelegram } from "./telegram.js";

export interface DoHttpEvent {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  path?: string;
  body?: string;
  queryString?: string;
  isBase64Encoded?: boolean;
}

export interface DoRawEvent {
  http?: DoHttpEvent;
  /** Legacy / alternate placements some runtimes may surface */
  __ow_headers?: Record<string, string | string[] | undefined>;
  __ow_method?: string;
  __ow_body?: string;
  __ow_query?: string;
  [key: string]: unknown;
}

export interface DoContext {
  activationId?: string;
  requestId?: string;
  getRemainingTimeInMillis?: () => number;
  functionVersion?: string;
  deadline?: number;
}

export interface HandlerDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function resolveHttp(event: DoRawEvent): {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string | undefined;
  queryString: string | undefined;
  isBase64Encoded: boolean | undefined;
} {
  const http = event.http;
  return {
    method: (http?.method ?? event.__ow_method ?? "GET").toUpperCase(),
    headers: http?.headers ?? event.__ow_headers ?? {},
    body: http?.body ?? (typeof event.__ow_body === "string" ? event.__ow_body : undefined),
    queryString:
      http?.queryString ?? (typeof event.__ow_query === "string" ? event.__ow_query : undefined),
    isBase64Encoded: http?.isBase64Encoded,
  };
}

function resolveRequestId(
  headers: ReturnType<typeof normalizeHeaders>,
  context: DoContext,
): string {
  const fromHeader = headers.get("x-request-id");
  if (fromHeader && /^[A-Za-z0-9_-]{8,128}$/.test(fromHeader)) {
    return fromHeader;
  }
  if (context.requestId && /^[A-Za-z0-9_-]{8,128}$/.test(context.requestId)) {
    return context.requestId;
  }
  if (context.activationId && /^[A-Za-z0-9_-]{8,128}$/.test(context.activationId)) {
    return context.activationId;
  }
  return randomUUID().replace(/-/g, "");
}

function remainingMs(context: DoContext, now: () => number): number {
  if (typeof context.getRemainingTimeInMillis === "function") {
    return Math.max(0, context.getRemainingTimeInMillis());
  }
  if (typeof context.deadline === "number") {
    return Math.max(0, context.deadline - now());
  }
  return 30_000;
}

function countAuthHeaders(headers: ReturnType<typeof normalizeHeaders>): number {
  return headers.getAll("authorization").length;
}

interface CompletionState {
  requestId: string;
  clientRef?: string;
  botAlias?: string;
  method?: string;
  outcome: string;
  upstreamStatus?: number;
  coldStart: boolean;
  started: number;
  logBotAlias: boolean;
}

function finish(
  state: CompletionState,
  response: ReturnType<typeof jsonResponse>,
  now: () => number,
): ReturnType<typeof jsonResponse> {
  writeCompletionLog({
    timestamp: new Date(now()).toISOString(),
    request_id: state.requestId,
    client_ref: state.clientRef,
    bot_alias: state.logBotAlias ? state.botAlias : undefined,
    method: state.method,
    outcome: state.outcome,
    upstream_status: state.upstreamStatus,
    duration_ms: Math.max(0, now() - state.started),
    cold_start: state.coldStart,
  });
  return response;
}

function fail(
  state: CompletionState,
  code: ErrorCode,
  extraHeaders: Record<string, string>,
  now: () => number,
): ReturnType<typeof jsonResponse> {
  state.outcome = code;
  return finish(state, nodegramError(code, state.requestId, extraHeaders), now);
}

export async function handleRequest(
  event: DoRawEvent,
  context: DoContext = {},
  deps: HandlerDeps = {},
): Promise<ReturnType<typeof jsonResponse>> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const started = now();
  const settings = loadRuntimeSettings(env);
  const http = resolveHttp(event);
  const headers = normalizeHeaders(http.headers);
  const requestId = resolveRequestId(headers, context);
  const origin = headers.get("origin");
  const cors = corsHeaders(origin, settings.allowedOrigins);

  const state: CompletionState = {
    requestId,
    outcome: "OK",
    coldStart: false,
    started,
    logBotAlias: settings.logBotAlias,
  };

  // CORS preflight
  if (http.method === "OPTIONS") {
    if (
      !corsEnabled(settings.allowedOrigins) ||
      !isOriginAllowed(origin, settings.allowedOrigins)
    ) {
      return fail(state, "METHOD_NOT_ALLOWED", cors, now);
    }
    state.outcome = "CORS_PREFLIGHT";
    return finish(
      state,
      jsonResponse(204, "", {
        ...cors,
        "content-type": "text/plain",
      }),
      now,
    );
  }

  // Health check
  if (http.method === "GET" && queryHasHealth(http.queryString)) {
    state.outcome = "HEALTH";
    const body: Record<string, unknown> = {
      ok: true,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      runtime: `nodejs:${process.versions.node}`,
      timestamp: new Date(now()).toISOString(),
    };
    if (settings.buildId) {
      body.build = settings.buildId;
    }
    return finish(state, jsonResponse(200, body, cors), now);
  }

  if (http.method !== "POST") {
    return fail(state, "METHOD_NOT_ALLOWED", cors, now);
  }

  // Config load
  const configResult = loadGatewayConfig(env);
  if (!configResult.ok) {
    writeConfigErrorLog(configResult.reason, requestId);
    state.coldStart = true;
    return fail(state, "CONFIGURATION_ERROR", cors, now);
  }
  state.coldStart = configResult.coldStart;
  const config = configResult.config;

  // Auth header uniqueness — no alternate credential locations
  if (countAuthHeaders(headers) > 1) {
    return fail(state, "UNAUTHORIZED", cors, now);
  }
  // Reject credentials in query string
  if (http.queryString && /(?:^|&)(?:authorization|api[_-]?key|token)=/i.test(http.queryString)) {
    return fail(state, "UNAUTHORIZED", cors, now);
  }

  const authHeader = headers.get("authorization");
  const presentedKey = parseBearerAuthorization(authHeader);
  const auth = authenticateClient(presentedKey, config);
  if (!auth.ok) {
    return fail(state, "UNAUTHORIZED", cors, now);
  }
  state.clientRef = anonymizeClientId(auth.client.id);

  // Content-Type
  if (!contentTypeIsJson(headers.get("content-type"))) {
    return fail(state, "UNSUPPORTED_MEDIA_TYPE", cors, now);
  }

  // Size: declared content-length when trustworthy
  const declared = trustworthyContentLength(headers.get("content-length"));
  if (declared !== undefined && declared > settings.maxBodyBytes) {
    return fail(state, "PAYLOAD_TOO_LARGE", cors, now);
  }

  const decoded = decodeRawBody(http.body, http.isBase64Encoded);
  if (!decoded.ok) {
    return fail(state, decoded.code, cors, now);
  }
  if (decoded.bytes.length > settings.maxBodyBytes) {
    return fail(state, "PAYLOAD_TOO_LARGE", cors, now);
  }

  const parsed = parseJsonObject(decoded.bytes);
  if (!parsed.ok) {
    return fail(state, parsed.code, cors, now);
  }

  const { bot, method, params } = parsed.envelope;
  state.botAlias = bot;
  state.method = method;

  // Bot alias authorization — only within authenticated client's map
  const token = auth.client.bots.get(bot);
  if (token === undefined) {
    return fail(state, "FORBIDDEN", cors, now);
  }

  // Best-effort rate limit
  if (settings.rateLimitEnabled) {
    const limiter = getSharedRateLimiter(settings.burst, settings.refillPerSecond);
    if (!limiter.tryConsume(auth.client.id)) {
      return fail(state, "RATE_LIMITED", cors, now);
    }
  }

  const tg = await callTelegram({
    botToken: token,
    method,
    params,
    timeoutMs: settings.requestTimeoutMs,
    remainingMs: remainingMs(context, now),
    fetchImpl: deps.fetchImpl,
  });

  if (!tg.ok) {
    state.outcome = tg.code;
    return finish(state, nodegramError(tg.code, requestId, cors), now);
  }

  state.outcome = "OK";
  state.upstreamStatus = tg.status;
  return finish(state, telegramPassthrough(tg.status, tg.body, tg.retryAfter, cors), now);
}

/**
 * DigitalOcean Functions entrypoint.
 */
export async function main(
  event: DoRawEvent = {},
  context: DoContext = {},
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    return await handleRequest(event, context);
  } catch {
    const requestId = context.requestId ?? context.activationId ?? randomUUID().replace(/-/g, "");
    writeCompletionLog({
      timestamp: new Date().toISOString(),
      request_id: requestId,
      client_ref: undefined,
      bot_alias: undefined,
      method: undefined,
      outcome: "INTERNAL_ERROR",
      upstream_status: undefined,
      duration_ms: 0,
      cold_start: false,
    });
    return nodegramError("INTERNAL_ERROR", requestId);
  }
}
