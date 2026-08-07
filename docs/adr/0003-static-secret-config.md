# ADR 0003: Static secret config for gateway keys

## Status

Accepted (updated in v1.1)

## Context

v1 must be deployable with minimal moving parts. Gateway access control still needs revocable keys, but Telegram bot tokens should not require a Function redeploy for every new bot.

## Decision

`NODEGRAM_CLIENTS_B64` stores only gateway client key **hashes** (and optional metadata). Telegram bot tokens are supplied by callers on each request. Base64 avoids shell quoting mistakes; it is **not** encryption.

## Consequences

- Adding a new bot does not require changing Function secrets — only the calling app's env.
- Compromised gateway keys are rotated via hash updates + redeploy.
- Path to a shared control plane remains: replace `loadGatewayConfig` while keeping the same runtime shape.
