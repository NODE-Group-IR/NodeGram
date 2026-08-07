# ADR 0001: Function envelope API

## Status

Accepted (v1)

## Context

Telegram Bot API URLs embed the bot token: `https://api.telegram.org/bot<token>/<method>`. Putting tokens in client-visible URLs, reverse-proxy paths, or CDN logs is a common leak vector. Application servers that cannot reach Telegram still need a small, auditable bridge.

## Decision

v1 exposes a single authenticated JSON envelope:

```json
{ "bot": "<alias>", "method": "<Method>", "params": {} }
```

Clients authenticate with a revocable Bearer client key. Bot tokens stay in Function secret configuration and are resolved by alias after authentication.

## Consequences

- Callers never possess bot tokens (unless they also operate the bots elsewhere).
- Method names and aliases are validated before URL construction.
- The API is language-agnostic HTTPS POST, not a Telegram SDK wrapper.
- Path-style `/bot<token>/...` proxying is intentionally unsupported.
