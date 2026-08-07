import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashClientKey, parseBearerAuthorization, authenticateClient } from "../src/auth.js";
import {
  resetConfigCacheForTests,
  loadGatewayConfig,
  validateClientsDocument,
} from "../src/config.js";
import { resetSharedRateLimiterForTests, BestEffortRateLimiter } from "../src/limits.js";
import { setLogSinkForTests } from "../src/logger.js";
import { handleRequest, main } from "../src/index.js";
import {
  buildTelegramUrl,
  callTelegram,
  computeUpstreamTimeout,
  telegramUpstreamOutcome,
} from "../src/telegram.js";
import { TELEGRAM_API_ORIGIN } from "../src/domain.js";
import {
  DISABLED_KEY,
  FAKE_BOT_TOKEN,
  OTHER_FAKE_BOT_TOKEN,
  OTHER_KEY,
  TEST_KEY,
  TEST_KEY_HASH,
  captureLogs,
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
  setLogSinkForTests(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  setLogSinkForTests(undefined);
});

describe("valid relay and upstream construction", () => {
  it("relays sendMessage with exact Telegram URL and JSON body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const res = await handleRequest(
      rawEvent({ body: relayBody() }),
      { getRemainingTimeInMillis: () => 25_000 },
      { env: testEnv(), fetchImpl },
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, result: { message_id: 1 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${TELEGRAM_API_ORIGIN}/bot${FAKE_BOT_TOKEN}/sendMessage`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.redirect).toBe("error");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.stringify(headers).toLowerCase()).not.toContain("authorization");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      chat_id: "123456789",
      text: "Hello from NodeGram",
    });
  });

  it("forwards getMe and getUpdates JSON", async () => {
    for (const method of ["getMe", "getUpdates"] as const) {
      resetConfigCacheForTests();
      const fetchImpl = mockFetchJson(200, { ok: true, result: { method } });
      const res = await handleRequest(
        rawEvent({
          body: relayBody({ method, params: method === "getUpdates" ? { timeout: 0 } : {} }),
        }),
        { getRemainingTimeInMillis: () => 25_000 },
        { env: testEnv(), fetchImpl },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true, result: { method } });
    }
  });
});

describe("authentication", () => {
  it("rejects missing, malformed, and duplicate bearer values", async () => {
    const env = testEnv();
    const fetchImpl = mockFetchJson(200, { ok: true });

    const missing = await handleRequest(
      rawEvent({ body: relayBody(), headers: { authorization: undefined as unknown as string } }),
      {},
      { env, fetchImpl },
    );
    // remove auth
    const noAuthEvent = rawEvent({ body: relayBody() });
    delete (noAuthEvent.http.headers as Record<string, unknown>).authorization;
    const missing2 = await handleRequest(noAuthEvent, {}, { env, fetchImpl });
    expect(missing2.statusCode).toBe(401);

    const malformed = await handleRequest(
      rawEvent({ body: relayBody(), headers: { authorization: "Basic abc" } }),
      {},
      { env, fetchImpl },
    );
    expect(malformed.statusCode).toBe(401);

    const duplicate = await handleRequest(
      rawEvent({
        body: relayBody(),
        headers: { authorization: [`Bearer ${TEST_KEY}`, `Bearer ${TEST_KEY}`] },
      }),
      {},
      { env, fetchImpl },
    );
    expect(duplicate.statusCode).toBe(401);

    expect(parseBearerAuthorization("Bearer ng_live_\u0000abc")).toBeNull();
    expect(parseBearerAuthorization(`Bearer ${"x".repeat(400)}`)).toBeNull();
    void missing;
  });

  it("rejects wrong key and disabled client", async () => {
    const env = testEnv();
    const fetchImpl = mockFetchJson(200, { ok: true });

    const wrong = await handleRequest(
      rawEvent({
        body: relayBody(),
        headers: { authorization: "Bearer ng_live_wrong_key_abcdefghijklmnopqrstuv" },
      }),
      {},
      { env, fetchImpl },
    );
    expect(wrong.statusCode).toBe(401);

    const disabled = await handleRequest(
      rawEvent({
        body: relayBody(),
        headers: { authorization: `Bearer ${DISABLED_KEY}` },
      }),
      {},
      { env, fetchImpl },
    );
    expect(disabled.statusCode).toBe(401);
  });

  it("forwards the caller-supplied bot token and rejects legacy bot alias field", async () => {
    const env = testEnv();
    let calledUrl = "";
    const fetchImpl = (async (url: string | URL | Request) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const res = await handleRequest(
      rawEvent({
        body: relayBody({ token: OTHER_FAKE_BOT_TOKEN, method: "getMe", params: {} }),
        headers: { authorization: `Bearer ${OTHER_KEY}` },
      }),
      { getRemainingTimeInMillis: () => 25_000 },
      { env, fetchImpl },
    );
    expect(res.statusCode).toBe(200);
    expect(calledUrl).toBe(`${TELEGRAM_API_ORIGIN}/bot${OTHER_FAKE_BOT_TOKEN}/getMe`);

    const legacy = await handleRequest(
      rawEvent({
        body: { bot: "notifications", method: "getMe", params: {} },
      }),
      {},
      { env, fetchImpl: mockFetchJson(200, { ok: true }) },
    );
    expect(legacy.statusCode).toBe(400);
  });

  it("runs constant-time path including malformed keys", () => {
    const config = validateClientsDocument(makeClientsDoc());
    expect(config).not.toBeNull();
    authenticateClient(null, config!);
    authenticateClient("not-a-valid-key", config!);
    authenticateClient(TEST_KEY, config!);
    expect(hashClientKey(TEST_KEY).equals(Buffer.from(TEST_KEY_HASH, "hex"))).toBe(true);
  });
});

describe("request validation", () => {
  it("rejects malformed base64, JSON, array body, invalid fields", async () => {
    const env = testEnv();
    const fetchImpl = mockFetchJson(200, { ok: true });

    const badB64 = await handleRequest(
      {
        http: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${TEST_KEY}`,
          },
          body: "!!!not-base64!!!",
          isBase64Encoded: true,
          queryString: "",
          path: "",
        },
      },
      {},
      { env, fetchImpl },
    );
    expect(badB64.statusCode).toBe(400);

    const badJson = await handleRequest(rawEvent({ rawBody: "{not json" }), {}, { env, fetchImpl });
    expect(badJson.statusCode).toBe(400);

    const arrayBody = await handleRequest(rawEvent({ rawBody: "[]" }), {}, { env, fetchImpl });
    expect(arrayBody.statusCode).toBe(400);

    const badToken = await handleRequest(
      rawEvent({ body: relayBody({ token: "not-a-token" }) }),
      {},
      { env, fetchImpl },
    );
    expect(badToken.statusCode).toBe(400);

    const badMethod = await handleRequest(
      rawEvent({ body: relayBody({ method: "send message" }) }),
      {},
      { env, fetchImpl },
    );
    expect(badMethod.statusCode).toBe(400);
  });

  it("enforces payload size and misleading content-length", async () => {
    const env = testEnv({ NODEGRAM_MAX_BODY_BYTES: "100" });
    const fetchImpl = mockFetchJson(200, { ok: true });

    const oversized = await handleRequest(
      rawEvent({
        body: relayBody({ params: { text: "x".repeat(200) } }),
      }),
      {},
      { env, fetchImpl },
    );
    expect(oversized.statusCode).toBe(413);

    const misleading = await handleRequest(
      rawEvent({
        body: relayBody(),
        headers: { "content-length": "999999" },
      }),
      {},
      { env: testEnv({ NODEGRAM_MAX_BODY_BYTES: "1000" }), fetchImpl },
    );
    expect(misleading.statusCode).toBe(413);
  });

  it("rejects method/alias injection and control characters", async () => {
    const env = testEnv();
    const fetchImpl = mockFetchJson(200, { ok: true });

    for (const method of ["sendMessage/../admin", "sendMessage%2Fevil", "send\nMessage"]) {
      const res = await handleRequest(
        rawEvent({ body: relayBody({ method }) }),
        {},
        { env, fetchImpl },
      );
      expect(res.statusCode).toBe(400);
    }
    for (const token of [
      "123/456:AAFakeTokenForUnitTestsOnlyXX",
      "123456789:AAFake?TokenForUnitTestsOnly",
      "badtoken",
    ]) {
      const res = await handleRequest(
        rawEvent({ body: relayBody({ token }) }),
        {},
        { env, fetchImpl },
      );
      expect(res.statusCode).toBe(400);
    }
  });

  it("rejects prototype pollution and excessive nesting", async () => {
    const env = testEnv();
    const fetchImpl = mockFetchJson(200, { ok: true });

    const polluted = await handleRequest(
      rawEvent({
        rawBody:
          '{"token":"123456789:AAFakeTokenForUnitTestsOnlyXX","method":"sendMessage","params":{"__proto__":{"admin":true}}}',
      }),
      {},
      { env, fetchImpl },
    );
    expect(polluted.statusCode).toBe(400);

    const constructorKey = await handleRequest(
      rawEvent({
        rawBody:
          '{"token":"123456789:AAFakeTokenForUnitTestsOnlyXX","method":"sendMessage","params":{"nested":{"constructor":{"prototype":{}}}}}',
      }),
      {},
      { env, fetchImpl },
    );
    expect(constructorKey.statusCode).toBe(400);

    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 40; i++) {
      deep = { child: deep };
    }
    const nested = await handleRequest(
      rawEvent({
        body: { token: FAKE_BOT_TOKEN, method: "sendMessage", params: deep },
      }),
      {},
      { env, fetchImpl },
    );
    expect(nested.statusCode).toBe(400);
  });

  it("rejects unsupported content type and non-POST", async () => {
    const env = testEnv();
    const fetchImpl = mockFetchJson(200, { ok: true });

    const ct = await handleRequest(
      rawEvent({ body: relayBody(), headers: { "content-type": "text/plain" } }),
      {},
      { env, fetchImpl },
    );
    expect(ct.statusCode).toBe(415);

    const put = await handleRequest(
      rawEvent({ method: "PUT", body: relayBody() }),
      {},
      { env, fetchImpl },
    );
    expect(put.statusCode).toBe(405);
  });
});

describe("config validation", () => {
  it("rejects duplicate IDs, invalid hashes/tokens, oversize config", () => {
    expect(
      validateClientsDocument(
        makeClientsDoc({
          clients: [
            {
              id: "a",
              keySha256: TEST_KEY_HASH,
              bots: { notifications: FAKE_BOT_TOKEN },
              enabled: true,
            },
            {
              id: "a",
              keySha256: createHash("sha256").update("x").digest("hex"),
              bots: { notifications: FAKE_BOT_TOKEN },
              enabled: true,
            },
          ],
        }),
      ),
    ).toBeNull();

    expect(
      validateClientsDocument(
        makeClientsDoc({
          clients: [
            {
              id: "a",
              keySha256: "not-a-hash",
              bots: { notifications: FAKE_BOT_TOKEN },
              enabled: true,
            },
          ],
        }),
      ),
    ).toBeNull();

    expect(
      validateClientsDocument(
        makeClientsDoc({
          clients: [
            {
              id: "a",
              keySha256: TEST_KEY_HASH,
              bots: { notifications: "bad-token" },
              enabled: true,
            },
          ],
        }),
      ),
    ).toBeNull();

    const huge = "A".repeat(300_000);
    const env = { NODEGRAM_CLIENTS_B64: Buffer.from(huge, "utf8").toString("base64") };
    expect(loadGatewayConfig(env).ok).toBe(false);
  });

  it("caches config across warm invocations", () => {
    const env = testEnv();
    const first = loadGatewayConfig(env);
    const second = loadGatewayConfig(env);
    expect(first.ok && first.coldStart).toBe(true);
    expect(second.ok && second.coldStart).toBe(false);
  });

  it("accepts keySha256 array for rotation", () => {
    const alt = createHash("sha256").update("ng_live_rotation_partner_abcdefghijkl").digest("hex");
    const config = validateClientsDocument(
      makeClientsDoc({
        clients: [
          {
            id: "rotating",
            keySha256: [TEST_KEY_HASH, alt],
            bots: { notifications: FAKE_BOT_TOKEN },
            enabled: true,
          },
        ],
      }),
    );
    expect(config).not.toBeNull();
    expect(config!.clients[0]!.keyDigests).toHaveLength(2);
  });
});

describe("telegram upstream", () => {
  it("handles timeout, network failure, redirect, invalid JSON, oversized response", async () => {
    const timeoutFetch = (async () => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }) as typeof fetch;
    const t = await callTelegram({
      botToken: FAKE_BOT_TOKEN,
      method: "getMe",
      params: {},
      timeoutMs: 1000,
      remainingMs: 5000,
      fetchImpl: timeoutFetch,
    });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.code).toBe("GATEWAY_TIMEOUT");

    const netFetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const n = await callTelegram({
      botToken: FAKE_BOT_TOKEN,
      method: "getMe",
      params: {},
      timeoutMs: 1000,
      remainingMs: 5000,
      fetchImpl: netFetch,
    });
    expect(n.ok).toBe(false);
    if (!n.ok) expect(n.code).toBe("BAD_GATEWAY");

    const badJson = (async () => new Response("not-json", { status: 200 })) as typeof fetch;
    const j = await callTelegram({
      botToken: FAKE_BOT_TOKEN,
      method: "getMe",
      params: {},
      timeoutMs: 1000,
      remainingMs: 5000,
      fetchImpl: badJson,
    });
    expect(j.ok).toBe(false);

    const huge = "x".repeat(950 * 1024);
    const oversized = (async () =>
      new Response(`{"ok":true,"pad":"${huge}"}`, { status: 200 })) as typeof fetch;
    const o = await callTelegram({
      botToken: FAKE_BOT_TOKEN,
      method: "getMe",
      params: {},
      timeoutMs: 1000,
      remainingMs: 5000,
      fetchImpl: oversized,
    });
    expect(o.ok).toBe(false);

    const declaredHuge = (async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { "content-length": String(950 * 1024) },
      })) as typeof fetch;
    const d = await callTelegram({
      botToken: FAKE_BOT_TOKEN,
      method: "getMe",
      params: {},
      timeoutMs: 1000,
      remainingMs: 5000,
      fetchImpl: declaredHuge,
    });
    expect(d.ok).toBe(false);
  });

  it("preserves Telegram 400/429/500 and safe retry-after", async () => {
    const env = testEnv();
    for (const status of [400, 429, 500]) {
      resetConfigCacheForTests();
      const fetchImpl = mockFetchJson(
        status,
        { ok: false, description: "upstream" },
        status === 429 ? { "retry-after": "12" } : {},
      );
      const res = await handleRequest(
        rawEvent({ body: relayBody({ method: "getMe", params: {} }) }),
        { getRemainingTimeInMillis: () => 25_000 },
        { env, fetchImpl },
      );
      expect(res.statusCode).toBe(status);
      expect(res.body).toEqual({ ok: false, description: "upstream" });
      if (status === 429) {
        expect(res.headers["retry-after"]).toBe("12");
      }
    }
  });

  it("does not automatically retry upstream failures", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await handleRequest(
      rawEvent({ body: relayBody({ method: "getMe", params: {} }) }),
      { getRemainingTimeInMillis: () => 25_000 },
      { env: testEnv(), fetchImpl },
    );
    expect(calls).toBe(1);
  });

  it("caps timeout below remaining context deadline", () => {
    expect(computeUpstreamTimeout(20_000, 5_000)).toBeLessThan(5_000);
    expect(computeUpstreamTimeout(20_000, 30_000)).toBe(20_000);
  });

  it("builds only fixed-origin URLs", () => {
    const url = buildTelegramUrl(FAKE_BOT_TOKEN, "getMe");
    expect(url.startsWith(`${TELEGRAM_API_ORIGIN}/bot`)).toBe(true);
    expect(url).not.toContain("http://");
    expect(() => buildTelegramUrl("bad/token", "getMe")).toThrow();
  });
});

describe("health and CORS", () => {
  it("health does not disclose secrets or config", async () => {
    const res = await handleRequest(
      rawEvent({ method: "GET", queryString: "health=1", body: {} }),
      {},
      { env: testEnv() },
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.service).toBe("nodegram");
    expect(body.version).toBe("1.1.0");
    expect(body.build).toBe("test-build");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain(FAKE_BOT_TOKEN);
    expect(serialized).not.toContain("website-production");
    expect(serialized).not.toContain(TEST_KEY_HASH);
    expect(body).not.toHaveProperty("clients");
    expect(body).not.toHaveProperty("bots");
  });

  it("CORS exact match and preflight", async () => {
    const env = testEnv({
      NODEGRAM_ALLOWED_ORIGINS: "https://app.example.com,https://admin.example.com",
    });

    const preflight = await handleRequest(
      rawEvent({
        method: "OPTIONS",
        headers: { origin: "https://app.example.com" },
      }),
      {},
      { env },
    );
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(preflight.headers.vary).toBe("Origin");

    const badOrigin = await handleRequest(
      rawEvent({
        method: "OPTIONS",
        headers: { origin: "https://evil.example.com" },
      }),
      {},
      { env },
    );
    expect(badOrigin.statusCode).toBe(405);

    const relay = await handleRequest(
      rawEvent({
        body: relayBody({ method: "getMe", params: {} }),
        headers: { origin: "https://app.example.com" },
      }),
      { getRemainingTimeInMillis: () => 25_000 },
      { env, fetchImpl: mockFetchJson(200, { ok: true, result: {} }) },
    );
    expect(relay.headers["access-control-allow-origin"]).toBe("https://app.example.com");
  });
});

describe("rate limiter", () => {
  it("limits bursts, bounds memory, evicts stale", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const limiter = new BestEffortRateLimiter({
      burst: 2,
      refillPerSecond: 0,
      maxEntries: 3,
      staleMs: 1_000,
      now: () => Date.now(),
    });

    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);

    limiter.tryConsume("b");
    limiter.tryConsume("c");
    expect(limiter.size()).toBeLessThanOrEqual(3);
    limiter.tryConsume("d");
    expect(limiter.size()).toBeLessThanOrEqual(3);

    vi.setSystemTime(now + 5_000);
    limiter.tryConsume("e");
    // stale eviction should have run
    expect(limiter.size()).toBeLessThanOrEqual(3);
    vi.useRealTimers();
  });
});

describe("logging redaction", () => {
  it("emits exactly one completion log without secrets", async () => {
    const { lines, restore } = captureLogs();
    try {
      await handleRequest(
        rawEvent({
          body: relayBody({
            params: { chat_id: "555666777", text: "SECRET_MESSAGE_TEXT" },
          }),
        }),
        { getRemainingTimeInMillis: () => 25_000 },
        {
          env: testEnv({ NODEGRAM_LOG_BOT_ID: "true" }),
          fetchImpl: mockFetchJson(200, { ok: true, result: {} }),
        },
      );
      expect(lines).toHaveLength(1);
      const joined = lines.join("\n");
      expect(joined).not.toContain(TEST_KEY);
      expect(joined).not.toContain(FAKE_BOT_TOKEN);
      expect(joined).not.toContain("AAFakeTokenForUnitTestsOnlyXX");
      expect(joined).not.toContain("SECRET_MESSAGE_TEXT");
      expect(joined).not.toContain("555666777");
      expect(joined).not.toContain(TEST_KEY_HASH);
      expect(joined).not.toContain(`${TELEGRAM_API_ORIGIN}/bot`);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.outcome).toBe("TELEGRAM_OK");
      expect(parsed.bot_id).toBe("123456789");
      expect(parsed.method).toBe("sendMessage");
    } finally {
      restore();
    }
  });

  it("classifies telegramUpstreamOutcome for non-2xx bands", () => {
    expect(telegramUpstreamOutcome(201)).toBe("TELEGRAM_OK");
    expect(telegramUpstreamOutcome(403)).toBe("TELEGRAM_CLIENT_ERROR");
    expect(telegramUpstreamOutcome(429)).toBe("TELEGRAM_RATE_LIMITED");
    expect(telegramUpstreamOutcome(503)).toBe("TELEGRAM_SERVER_ERROR");
    expect(telegramUpstreamOutcome(100)).toBe("TELEGRAM_CLIENT_ERROR");
  });

  it("maps Telegram HTTP statuses to distinct log outcomes", async () => {
    const cases: Array<{ status: number; outcome: string }> = [
      { status: 200, outcome: "TELEGRAM_OK" },
      { status: 400, outcome: "TELEGRAM_CLIENT_ERROR" },
      { status: 429, outcome: "TELEGRAM_RATE_LIMITED" },
      { status: 500, outcome: "TELEGRAM_SERVER_ERROR" },
    ];
    for (const { status, outcome } of cases) {
      const { lines, restore } = captureLogs();
      try {
        resetConfigCacheForTests();
        await handleRequest(
          rawEvent({ body: relayBody({ method: "getMe", params: {} }) }),
          { getRemainingTimeInMillis: () => 25_000 },
          {
            env: testEnv(),
            fetchImpl: mockFetchJson(status, { ok: false, description: "upstream" }),
          },
        );
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]!);
        expect(parsed.outcome).toBe(outcome);
        expect(parsed.upstream_status).toBe(status);
      } finally {
        restore();
      }
    }
  });
});

describe("DigitalOcean raw fixtures", () => {
  it("smoke-tests getMe through main with realistic raw event", async () => {
    resetConfigCacheForTests();
    const env = testEnv();
    // Temporarily set process.env for main()
    const prev = { ...process.env };
    Object.assign(process.env, env);

    const originalFetch = globalThis.fetch;
    let calledUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ ok: true, result: { id: 1, is_bot: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const event = {
        http: {
          method: "POST",
          headers: {
            Accept: "*/*",
            "Content-Type": "application/json",
            Authorization: `Bearer ${TEST_KEY}`,
            "User-Agent": "curl/8.0.0",
            "X-Request-Id": "fixture-request-id-001",
          },
          body: Buffer.from(
            JSON.stringify({ token: FAKE_BOT_TOKEN, method: "getMe", params: {} }),
            "utf8",
          ).toString("base64"),
          isBase64Encoded: true,
          queryString: "",
          path: "",
        },
      };

      const res = await main(event, {
        requestId: "fixture-request-id-001",
        getRemainingTimeInMillis: () => 25_000,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true, result: { id: 1, is_bot: true } });
      expect(calledUrl).toBe(`${TELEGRAM_API_ORIGIN}/bot${FAKE_BOT_TOKEN}/getMe`);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of Object.keys(process.env)) {
        if (!(key in prev)) delete process.env[key];
      }
      Object.assign(process.env, prev);
    }
  });

  it("returns CONFIGURATION_ERROR when clients secret missing", async () => {
    const res = await handleRequest(rawEvent({ body: relayBody() }), {}, { env: {} });
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      ok: false,
      error: { code: "CONFIGURATION_ERROR" },
    });
  });
});

describe("encode helpers", () => {
  it("clientsB64 round-trips", () => {
    const doc = makeClientsDoc();
    const b64 = clientsB64(doc);
    expect(JSON.parse(Buffer.from(b64, "base64").toString("utf8"))).toEqual(doc);
  });
});
