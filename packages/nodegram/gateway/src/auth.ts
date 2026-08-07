import { createHash, timingSafeEqual } from "node:crypto";
import {
  KEY_PREFIX,
  MAX_BEARER_TOKEN_LENGTH,
  type ClientConfig,
  type GatewayConfig,
} from "./domain.js";

/** Fixed dummy digest so auth always performs at least one timingSafeEqual. */
const DUMMY_DIGEST = createHash("sha256").update("nodegram-dummy-auth-compare").digest();

export function hashClientKey(plaintext: string): Buffer {
  return createHash("sha256").update(plaintext, "utf8").digest();
}

export function parseBearerAuthorization(headerValue: string | undefined): string | null {
  if (typeof headerValue !== "string") {
    return null;
  }
  if (headerValue.length > MAX_BEARER_TOKEN_LENGTH + 16) {
    return null;
  }
  // Reject control characters
  for (let i = 0; i < headerValue.length; i++) {
    const c = headerValue.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      return null;
    }
  }

  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(headerValue);
  if (!match) {
    return null;
  }
  const token = match[1];
  if (!token || token.length > MAX_BEARER_TOKEN_LENGTH) {
    return null;
  }
  if (!token.startsWith(KEY_PREFIX)) {
    return null;
  }
  // Require meaningful secret material after prefix
  if (token.length < KEY_PREFIX.length + 16) {
    return null;
  }
  return token;
}

export type AuthResult =
  { ok: true; client: ClientConfig } | { ok: false; reason: "missing" | "invalid" | "disabled" };

function digestEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Authenticate a presented client key against configured digests.
 * Always performs at least one timingSafeEqual against a dummy digest.
 */
export function authenticateClient(presentedKey: string | null, config: GatewayConfig): AuthResult {
  // Always compare against dummy first to reduce timing variance on missing keys.
  let matched = false;
  let matchedClient: ClientConfig | undefined;

  const presentedDigest = presentedKey === null ? DUMMY_DIGEST : hashClientKey(presentedKey);

  // Ensure at least one comparison always runs.
  digestEquals(presentedDigest, DUMMY_DIGEST);

  if (presentedKey === null) {
    return { ok: false, reason: "missing" };
  }

  for (const client of config.clients) {
    for (const digest of client.keyDigests) {
      if (digestEquals(presentedDigest, digest)) {
        matched = true;
        matchedClient = client;
      }
    }
  }

  if (!matched || !matchedClient) {
    return { ok: false, reason: "invalid" };
  }

  if (!matchedClient.enabled) {
    return { ok: false, reason: "disabled" };
  }

  return { ok: true, client: matchedClient };
}

/** Stable anonymized client reference for logs (not the plaintext id in some deployments). */
export function anonymizeClientId(clientId: string): string {
  return createHash("sha256").update(`nodegram-client:${clientId}`).digest("hex").slice(0, 16);
}
