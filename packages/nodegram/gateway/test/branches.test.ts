import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseBearerAuthorization } from "../src/auth.js";
import { loadGatewayConfig, loadRuntimeSettings, resetConfigCacheForTests } from "../src/config.js";
import { parseAllowedOrigins } from "../src/cors.js";
import { BestEffortRateLimiter, resetSharedRateLimiterForTests } from "../src/limits.js";
import { setLogSinkForTests, writeCompletionLog } from "../src/logger.js";
import { decodeRawBody, queryHasHealth, trustworthyContentLength } from "../src/request.js";
import { callTelegram } from "../src/telegram.js";
import { handleRequest } from "../src/index.js";
import {
  FAKE_BOT_TOKEN,
  rawEvent,
  relayBody,
  testEnv,
  mockFetchJson,
  clientsB64,
} from "./helpers.js";

beforeEach(() => {
  resetConfigCacheForTests();
  resetSharedRateLimiterForTests();
  setLogSinkForTests(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("branch coverage extras", () => {
  it("auth control characters and oversize header string", () => {
    expect(parseBearerAuthorization("Bearer ng_live_ok\u0001morestuffabcdefgh")).toBeNull();
    const long = "Bearer " + "ng_live_" + "a".repeat(400);
    expect(parseBearerAuthorization(long)).toBeNull();
  });

  it("config empty string env and invalid numbers", () => {
    expect(loadGatewayConfig({ NODEGRAM_CLIENTS_B64: "" }).ok).toBe(false);
    const s = loadRuntimeSettings({
      NODEGRAM_MAX_BODY_BYTES: "-5",
      NODEGRAM_REQUEST_TIMEOUT_MS: "abc",
      NODEGRAM_RATE_LIMIT: "false",
      NODEGRAM_ALLOWED_ORIGINS: undefined,
    });
    expect(s.maxBodyBytes).toBe(750 * 1024);
    expect(s.rateLimitEnabled).toBe(false);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });

  it("limiter disabled when burst zero", () => {
    const limiter = new BestEffortRateLimiter({ burst: 0, refillPerSecond: 1 });
    expect(limiter.tryConsume("x")).toBe(true);
  });

  it("logger default sink and minimal completion fields", () => {
    setLogSinkForTests(undefined);
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeCompletionLog({
      timestamp: new Date().toISOString(),
      request_id: "r",
      client_ref: undefined,
      bot_id: undefined,
      method: undefined,
      outcome: "HEALTH",
      upstream_status: undefined,
      duration_ms: 0,
      cold_start: false,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("decode and query edge paths", () => {
    expect(decodeRawBody(undefined, true).ok).toBe(false);
    expect(queryHasHealth(undefined)).toBe(false);
    expect(queryHasHealth("")).toBe(false);
    expect(trustworthyContentLength(undefined)).toBeUndefined();
  });

  it("telegram http-date retry-after", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: false }), {
        status: 429,
        headers: { "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT" },
      })) as typeof fetch;
    const r = await callTelegram({
      botToken: FAKE_BOT_TOKEN,
      method: "getMe",
      params: {},
      timeoutMs: 1000,
      remainingMs: 5000,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.retryAfter).toBeDefined();
  });

  it("uses activationId and rejects empty body", async () => {
    const res = await handleRequest(
      rawEvent({ method: "GET", queryString: "health=1" }),
      { activationId: "activationidvalue01" },
      { env: testEnv() },
    );
    expect(res.statusCode).toBe(200);

    const empty = await handleRequest(
      {
        http: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.X || "ng_live_test_key_abcdefghijklmnopqrstuvwxyz12"}`,
          },
          body: "",
          isBase64Encoded: true,
          queryString: "",
          path: "",
        },
      },
      {},
      { env: testEnv(), fetchImpl: mockFetchJson(200, { ok: true }) },
    );
    expect(empty.statusCode).toBe(400);
  });

  it("invalid clients document shapes", () => {
    expect(
      loadGatewayConfig({
        NODEGRAM_CLIENTS_B64: Buffer.from(JSON.stringify([1, 2, 3]), "utf8").toString("base64"),
      }).ok,
    ).toBe(false);
    expect(
      loadGatewayConfig({
        NODEGRAM_CLIENTS_B64: clientsB64({
          schemaVersion: 1,
          clients: [
            {
              id: "ok",
              keySha256: 123,
              bots: { notifications: FAKE_BOT_TOKEN },
              enabled: true,
            },
          ],
        }),
      }).ok,
    ).toBe(false);
  });

  it("legacy ow fields and non-json health skip", async () => {
    const res = await handleRequest(
      {
        __ow_method: "GET",
        __ow_query: "health=1",
        __ow_headers: { "x-request-id": "legacyreqid00000001" },
      },
      {},
      { env: testEnv() },
    );
    expect(res.statusCode).toBe(200);

    const put = await handleRequest(
      rawEvent({ body: relayBody(), method: "PATCH" }),
      {},
      { env: testEnv() },
    );
    expect(put.statusCode).toBe(405);
  });
});
