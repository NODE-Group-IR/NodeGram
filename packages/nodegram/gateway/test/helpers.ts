import { createHash } from "node:crypto";
import type { GatewayConfig } from "../src/domain.js";

export const TEST_KEY = "ng_live_test_key_abcdefghijklmnopqrstuvwxyz12";
export const TEST_KEY_HASH = createHash("sha256").update(TEST_KEY, "utf8").digest("hex");

export const OTHER_KEY = "ng_live_other_key_abcdefghijklmnopqrstuvwxyz99";
export const OTHER_KEY_HASH = createHash("sha256").update(OTHER_KEY, "utf8").digest("hex");

export const DISABLED_KEY = "ng_live_disabled_key_abcdefghijklmnopqrstuvwx";
export const DISABLED_KEY_HASH = createHash("sha256").update(DISABLED_KEY, "utf8").digest("hex");

/** Placeholder token shape — not a live credential. */
export const FAKE_BOT_TOKEN = "123456789:AAFakeTokenForUnitTestsOnlyXX";

export function makeClientsDoc(overrides?: { clients?: unknown[] }): Record<string, unknown> {
  return {
    schemaVersion: 1,
    clients: overrides?.clients ?? [
      {
        id: "website-production",
        keySha256: TEST_KEY_HASH,
        bots: {
          notifications: FAKE_BOT_TOKEN,
          alerts: "987654321:AAAnotherFakeTokenForTestsOnlyY",
        },
        enabled: true,
      },
      {
        id: "other-tenant",
        keySha256: OTHER_KEY_HASH,
        bots: {
          notifications: "111111111:AAOtherTenantFakeTokenOnlyZZZZ",
        },
        enabled: true,
      },
      {
        id: "disabled-client",
        keySha256: DISABLED_KEY_HASH,
        bots: {
          notifications: FAKE_BOT_TOKEN,
        },
        enabled: false,
      },
    ],
  };
}

export function clientsB64(doc: unknown = makeClientsDoc()): string {
  return Buffer.from(JSON.stringify(doc), "utf8").toString("base64");
}

export function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODEGRAM_CLIENTS_B64: clientsB64(),
    NODEGRAM_REQUEST_TIMEOUT_MS: "20000",
    NODEGRAM_MAX_BODY_BYTES: "768000",
    NODEGRAM_BURST: "1000",
    NODEGRAM_REFILL_PER_SECOND: "100",
    NODEGRAM_LOG_BOT_ALIAS: "false",
    NODEGRAM_BUILD_ID: "test-build",
    NODEGRAM_RATE_LIMIT: "off",
    ...extra,
  };
}

export function rawEvent(opts: {
  method?: string;
  body?: unknown;
  rawBody?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | string[]>;
  queryString?: string;
}): {
  http: {
    method: string;
    headers: Record<string, string | string[]>;
    body: string;
    queryString: string;
    isBase64Encoded: boolean;
    path: string;
  };
} {
  const json =
    opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : JSON.stringify({}));
  const isB64 = opts.isBase64Encoded !== false;
  return {
    http: {
      method: opts.method ?? "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TEST_KEY}`,
        ...opts.headers,
      },
      body: isB64 ? Buffer.from(json, "utf8").toString("base64") : json,
      queryString: opts.queryString ?? "",
      isBase64Encoded: isB64,
      path: "",
    },
  };
}

export function relayBody(
  partial: Partial<{ bot: string; method: string; params: Record<string, unknown> }> = {},
): Record<string, unknown> {
  return {
    bot: "notifications",
    method: "sendMessage",
    params: { chat_id: "123456789", text: "Hello from NodeGram" },
    ...partial,
  };
}

export function mockFetchJson(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): typeof fetch {
  return (async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }) as typeof fetch;
}

import { setLogSinkForTests } from "../src/logger.js";
import { validateClientsDocument } from "../src/config.js";

export function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  setLogSinkForTests((line) => {
    lines.push(line);
  });
  return {
    lines,
    restore: () => setLogSinkForTests(undefined),
  };
}

export function frozenConfigFromDoc(doc = makeClientsDoc()): GatewayConfig {
  const config = validateClientsDocument(doc);
  if (!config) throw new Error("fixture config invalid");
  return config;
}
