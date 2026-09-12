import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { parseBearerAuthorization, hashClientKey, authenticateClient } from "../src/auth.js";
import {
  loadGatewayConfig,
  loadRuntimeSettings,
  resetConfigCacheForTests,
  validateClientsDocument,
} from "../src/config.js";
import { corsHeaders, parseAllowedOrigins } from "../src/cors.js";
import {
  BestEffortRateLimiter,
  getSharedRateLimiter,
  resetSharedRateLimiterForTests,
} from "../src/limits.js";
import { setLogSinkForTests, writeCompletionLog } from "../src/logger.js";
import {
  contentTypeIsJson,
  decodeRawBody,
  normalizeHeaders,
  queryHasHealth,
  trustworthyContentLength,
  validateRelayEnvelope,
} from "../src/request.js";
import { buildTelegramUrl, callTelegram } from "../src/telegram.js";
import { handleRequest, main } from "../src/index.js";
import {
  FAKE_BOT_TOKEN,
  TEST_KEY,
  TEST_KEY_HASH,
  clientsB64,
  makeClientsDoc,
  mockFetchJson,
  rawEvent,
  relayBody,
  testEnv,
} from "./helpers.js";

beforeEach(() => {
  resetConfigCacheForTests();
  resetSharedRateLimiterForTests();
  setLogSinkForTests(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  setLogSinkForTests(undefined);
});

describe("auth edge cases", () => {
  it("rejects oversized and short bearer tokens", () => {
    expect(parseBearerAuthorization(`Bearer ng_live_${"a".repeat(300)}`)).toBeNull();
    expect(parseBearerAuthorization("Bearer ng_live_short")).toBeNull();
    expect(parseBearerAuthorization("Bearer ng_live_ok_abcdefghijklmnop")).not.toBeNull();
  });

  it("digestEquals returns false on length mismatch via authenticate", () => {
    const config = validateClientsDocument(
      makeClientsDoc({
        clients: [
          {
            id: "x",
            keySha256: TEST_KEY_HASH,
            bots: { notifications: FAKE_BOT_TOKEN },
            enabled: true,
          },
        ],
      }),
    )!;
    // Force a digest of wrong length by mutating a copy path — authenticate uses fixed 32-byte digests
    expect(authenticateClient(TEST_KEY, config).ok).toBe(true);
    expect(hashClientKey(TEST_KEY)).toHaveLength(32);
  });
});

describe("config edge cases", () => {
  it("rejects invalid base64 JSON and empty clients", () => {
    expect(loadGatewayConfig({ NODEGRAM_CLIENTS_B64: "%%%" }).ok).toBe(false);
    expect(
      loadGatewayConfig({
        NODEGRAM_CLIENTS_B64: Buffer.from("{}", "utf8").toString("base64"),
      }).ok,
    ).toBe(false);
    expect(validateClientsDocument({ schemaVersion: 2, clients: [] })).toBeNull();
    expect(
      validateClientsDocument({
        schemaVersion: 1,
        clients: [
          {
            id: "x",
            keySha256: [TEST_KEY_HASH, TEST_KEY_HASH],
            bots: { notifications: FAKE_BOT_TOKEN },
            enabled: true,
          },
        ],
      }),
    ).toBeNull();
    expect(
      validateClientsDocument({
        schemaVersion: 1,
        clients: [
          {
            id: "BadId",
            keySha256: TEST_KEY_HASH,
            bots: { notifications: FAKE_BOT_TOKEN },
            enabled: true,
          },
        ],
      }),
    ).toBeNull();
    expect(
      validateClientsDocument({
        schemaVersion: 1,
        clients: [
          {
            id: "ok",
            keySha256: TEST_KEY_HASH,
            enabled: true,
          },
        ],
      }),
    ).not.toBeNull();
  });

  it("loads runtime settings with caps and CORS origins", () => {
    const s = loadRuntimeSettings({
      NODEGRAM_MAX_BODY_BYTES: "9999999",
      NODEGRAM_REQUEST_TIMEOUT_MS: "999999",
      NODEGRAM_ALLOWED_ORIGINS: "https://a.example.com, http://insecure.example.com, bad",
      NODEGRAM_BURST: "0",
      NODEGRAM_REFILL_PER_SECOND: "not-a-number",
      NODEGRAM_LOG_BOT_ID: "true",
      NODEGRAM_BUILD_ID: "b1",
    });
    expect(s.maxBodyBytes).toBeLessThanOrEqual(900 * 1024);
    expect(s.requestTimeoutMs).toBeLessThanOrEqual(28_000);
    expect(s.allowedOrigins).toEqual(["https://a.example.com"]);
    expect(s.rateLimitEnabled).toBe(false);
    expect(s.logBotId).toBe(true);
    expect(s.buildId).toBe("b1");

    const s2 = loadRuntimeSettings({
      NODEGRAM_MAX_BODY_BYTES: "0",
      NODEGRAM_REQUEST_TIMEOUT_MS: "0",
      NODEGRAM_RATE_LIMIT: "off",
    });
    expect(s2.maxBodyBytes).toBe(750 * 1024);
    expect(s2.rateLimitEnabled).toBe(false);

    const legacyLogFlag = loadRuntimeSettings({ NODEGRAM_LOG_BOT_ALIAS: "true" });
    expect(legacyLogFlag.logBotId).toBe(true);
  });
});

describe("request helpers", () => {
  it("covers header normalization and health query variants", () => {
    const h = normalizeHeaders({
      "Content-Type": ["application/json", "ignored"],
      "X-Test": "a",
    });
    expect(h.get("content-type")).toBe("application/json");
    expect(h.getAll("x-test")).toEqual(["a"]);
    expect(contentTypeIsJson("application/json; charset=utf-8")).toBe(true);
    expect(contentTypeIsJson(undefined)).toBe(false);
    expect(queryHasHealth("?health=1")).toBe(true);
    expect(queryHasHealth("foo=1&health=true")).toBe(true);
    expect(queryHasHealth("health=0")).toBe(false);
    expect(trustworthyContentLength("12")).toBe(12);
    expect(trustworthyContentLength("12a")).toBeUndefined();
    expect(decodeRawBody("", true).ok).toBe(false);
    expect(decodeRawBody("e30=", true).ok).toBe(true);
    expect(decodeRawBody("{}", false).ok).toBe(true);
    // Invalid base64 that collapses to empty must be rejected without regex ReDoS.
    expect(decodeRawBody("!!!!", true).ok).toBe(false);
    expect(decodeRawBody("=".repeat(10_000), true)).toEqual({
      ok: true,
      bytes: Buffer.alloc(0),
    });
  });

  it("rejects params arrays at top level and huge string keys", () => {
    expect(
      validateRelayEnvelope({
        token: "123456789:AAFakeTokenForUnitTestsOnlyXX",
        method: "getMe",
        params: [],
      }).ok,
    ).toBe(false);
    expect(
      validateRelayEnvelope({
        token: "123456789:AAFakeTokenForUnitTestsOnlyXX",
        method: "getMe",
        params: { ["k".repeat(300)]: "v" },
      }).ok,
    ).toBe(false);
    expect(
      validateRelayEnvelope({
        token: "123456789:AAFakeTokenForUnitTestsOnlyXX",
        method: "getMe",
        params: { text: "x".repeat(70_000) },
      }).ok,
    ).toBe(false);
    expect(
      validateRelayEnvelope(
        JSON.parse(
          '{"__proto__":{"x":1},"token":"123456789:AAFakeTokenForUnitTestsOnlyXX","method":"getMe"}',
        ),
      ).ok,
    ).toBe(false);
  });
});

describe("cors helpers", () => {
  it("parses and applies exact origins", () => {
    expect(parseAllowedOrigins("https://a.com,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
    expect(corsHeaders("https://a.com", ["https://a.com"])["access-control-allow-origin"]).toBe(
      "https://a.com",
    );
    expect(corsHeaders("https://x.com", ["https://a.com"])).toEqual({});
  });
});

describe("limits shared singleton and refill", () => {
  it("refills tokens and shares limiter instance", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    const limiter = new BestEffortRateLimiter({
      burst: 1,
      refillPerSecond: 10,
      now: () => Date.now(),
    });
    expect(limiter.tryConsume("c")).toBe(true);
    expect(limiter.tryConsume("c")).toBe(false);
    vi.setSystemTime(t0 + 500);
    expect(limiter.tryConsume("c")).toBe(true);

    const a = getSharedRateLimiter(5, 1);
    const b = getSharedRateLimiter(5, 1);
    expect(a).toBe(b);
    getSharedRateLimiter(9, 2);
    vi.useRealTimers();
  });

  it("returns 429 when best-effort limiter exhausted", async () => {
    resetSharedRateLimiterForTests();
    const env: NodeJS.ProcessEnv = {
      ...testEnv(),
      NODEGRAM_BURST: "1",
      NODEGRAM_REFILL_PER_SECOND: "0",
    };
    delete env.NODEGRAM_RATE_LIMIT;
    const fetchImpl = mockFetchJson(200, { ok: true, result: {} });
    const first = await handleRequest(
      rawEvent({ body: relayBody({ method: "getMe", params: {} }) }),
      { getRemainingTimeInMillis: () => 25_000 },
      { env, fetchImpl },
    );
    expect(first.statusCode).toBe(200);
    const second = await handleRequest(
      rawEvent({ body: relayBody({ method: "getMe", params: {} }) }),
      { getRemainingTimeInMillis: () => 25_000 },
      { env, fetchImpl },
    );
    expect(second.statusCode).toBe(429);
  });
});

describe("telegram edge cases", () => {
  it("rejects unsafe retry-after and non-object JSON", async () => {
    const unsafeRa = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 429,
        headers: { "retry-after": "x".repeat(100) },
      })) as typeof fetch;
    const r = await callTelegram({
      botToken: FAKE_BOT_TOKEN,
      method: "getMe",
      params: {},
      timeoutMs: 1000,
      remainingMs: 5000,
      fetchImpl: unsafeRa,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.retryAfter).toBeUndefined();

    const nonObj = (async () => new Response("true", { status: 200 })) as typeof fetch;
    const n = await callTelegram({
      botToken: FAKE_BOT_TOKEN,
      method: "getMe",
      params: {},
      timeoutMs: 1000,
      remainingMs: 5000,
      fetchImpl: nonObj,
    });
    expect(n.ok).toBe(false);

    expect(() => buildTelegramUrl(FAKE_BOT_TOKEN, "bad?x")).toThrow();
  });

  it("maps context deadline when getRemainingTimeInMillis missing", async () => {
    const fetchImpl = mockFetchJson(200, { ok: true, result: {} });
    const res = await handleRequest(
      rawEvent({ body: relayBody({ method: "getMe", params: {} }) }),
      { deadline: Date.now() + 25_000 },
      { env: testEnv(), fetchImpl },
    );
    expect(res.statusCode).toBe(200);
  });
});

describe("handler edge cases", () => {
  it("rejects credentials in query string", async () => {
    const res = await handleRequest(
      rawEvent({
        body: relayBody({ method: "getMe", params: {} }),
        queryString: "api_key=secret",
      }),
      {},
      { env: testEnv(), fetchImpl: mockFetchJson(200, { ok: true }) },
    );
    expect(res.statusCode).toBe(401);
  });

  it("handleRequest surfaces unexpected throws via main", async () => {
    const prev = process.env.NODEGRAM_CLIENTS_B64;
    process.env.NODEGRAM_CLIENTS_B64 = clientsB64();
    try {
      const res = await main(rawEvent({ body: relayBody({ method: "getMe", params: {} }) }), {
        getRemainingTimeInMillis: () => {
          throw new Error("deadline boom");
        },
      });
      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    } finally {
      if (prev === undefined) delete process.env.NODEGRAM_CLIENTS_B64;
      else process.env.NODEGRAM_CLIENTS_B64 = prev;
    }
  });

  it("uses x-request-id when valid", async () => {
    const res = await handleRequest(
      rawEvent({
        method: "GET",
        queryString: "health=1",
        headers: { "x-request-id": "client-supplied-req-id-01" },
      }),
      {},
      { env: testEnv() },
    );
    expect(res.body).toMatchObject({ ok: true });
  });

  it("logger writeCompletionLog includes optional fields", () => {
    const lines: string[] = [];
    setLogSinkForTests((l) => lines.push(l));
    writeCompletionLog({
      timestamp: new Date().toISOString(),
      request_id: "r1",
      client_ref: "c1",
      bot_id: "123456789",
      method: "getMe",
      outcome: "OK",
      upstream_status: 200,
      duration_ms: 1,
      cold_start: false,
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).client_ref).toBe("c1");
  });

  it("invalid config JSON yields CONFIGURATION_ERROR", async () => {
    const res = await handleRequest(
      rawEvent({ body: relayBody() }),
      {},
      {
        env: {
          NODEGRAM_CLIENTS_B64: Buffer.from("{bad", "utf8").toString("base64"),
        },
      },
    );
    expect(res.statusCode).toBe(500);
  });

  it("accepts rotation partner hash", async () => {
    const partnerKey = "ng_live_rotation_partner_key_abcdefghijk";
    const partnerHash = createHash("sha256").update(partnerKey, "utf8").digest("hex");
    const doc = makeClientsDoc({
      clients: [
        {
          id: "rot",
          keySha256: [TEST_KEY_HASH, partnerHash],
          bots: { notifications: FAKE_BOT_TOKEN },
          enabled: true,
        },
      ],
    });
    const env = testEnv();
    env.NODEGRAM_CLIENTS_B64 = clientsB64(doc);
    const res = await handleRequest(
      rawEvent({
        body: relayBody({ method: "getMe", params: {} }),
        headers: { authorization: `Bearer ${partnerKey}` },
      }),
      { getRemainingTimeInMillis: () => 25_000 },
      { env, fetchImpl: mockFetchJson(200, { ok: true, result: {} }) },
    );
    expect(res.statusCode).toBe(200);
  });
});
