# ADR 0001: Function envelope API

## Status

Accepted (updated in v1.1)

## Context

Telegram Bot API URLs embed the bot token: `https://api.telegram.org/bot<token>/<method>`. Application servers that cannot reach Telegram still need a small, auditable bridge. Operators also need many independent bots (one per product/tenant) without storing every bot token inside the Function configuration.

## Decision

Expose a single authenticated JSON envelope:

```json
{ "token": "<telegram_bot_token>", "method": "<Method>", "params": {} }
```

Callers authenticate to NodeGram with a revocable Bearer **gateway** key. Each request also includes that caller's Telegram bot token. The upstream URL is always constructed as `https://api.telegram.org/bot<token>/<method>` after shape validation. Tokens are never accepted in the NodeGram URL path or query string and are never logged.

## Consequences

- Any authorized gateway client can use its own Telegram bot without a Function redeploy.
- Application servers must protect bot tokens the same way they protect other secrets.
- Method names and tokens are validated before URL construction.
- Path-style open proxies and arbitrary upstream hosts remain unsupported.
