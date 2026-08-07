# API contract

Base URL: your DigitalOcean Functions web URL for `nodegram/gateway`.

## `POST /` — relay

### Headers

```http
Authorization: Bearer ng_live_<secret>
Content-Type: application/json
```

Credentials are accepted only in the `Authorization` header. Duplicate `Authorization` headers, query-string credentials, or alternate credential locations are rejected.

### Body

```json
{
  "bot": "notifications",
  "method": "sendMessage",
  "params": {
    "chat_id": "123456789",
    "text": "Hello from NodeGram"
  }
}
```

| Field    | Required | Rules                                                                                                                                                                                                                              |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot`    | Yes      | `^[a-z0-9][a-z0-9_-]{0,47}$`                                                                                                                                                                                                       |
| `method` | Yes      | `^[A-Za-z][A-Za-z0-9]{0,63}$`                                                                                                                                                                                                      |
| `params` | No       | Plain JSON object; default `{}`. Arrays at the top level are rejected. Nested arrays in params are allowed when depth/key/string limits permit. Dangerous keys (`__proto__`, `prototype`, `constructor`) are rejected recursively. |

### Success

Telegram's JSON body and HTTP status are returned. Inspect Telegram's `ok` field.

Safe `retry-after` values from Telegram may be forwarded.

### NodeGram errors

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing client credentials",
    "request_id": "..."
  }
}
```

| Status | Code                                     | Meaning                                        |
| ------ | ---------------------------------------- | ---------------------------------------------- |
| 400    | `INVALID_REQUEST`                        | Malformed envelope or validation failure       |
| 401    | `UNAUTHORIZED`                           | Missing/invalid/disabled credentials           |
| 403    | `FORBIDDEN`                              | Authenticated client cannot use that bot alias |
| 405    | `METHOD_NOT_ALLOWED`                     | Non-POST (except health/CORS)                  |
| 413    | `PAYLOAD_TOO_LARGE`                      | Body exceeds configured limit                  |
| 415    | `UNSUPPORTED_MEDIA_TYPE`                 | Content-Type is not JSON                       |
| 429    | `RATE_LIMITED`                           | Best-effort local throttle                     |
| 500    | `CONFIGURATION_ERROR` / `INTERNAL_ERROR` | Config or unexpected failure                   |
| 502    | `BAD_GATEWAY`                            | Invalid/unavailable Telegram response          |
| 504    | `GATEWAY_TIMEOUT`                        | Upstream timed out                             |

## `GET /?health=1`

Returns:

```json
{
  "ok": true,
  "service": "nodegram",
  "version": "1.0.0",
  "runtime": "nodejs:...",
  "timestamp": "...",
  "build": "optional-build-id"
}
```

Does not call Telegram. Does not expose client IDs, aliases, hashes, tokens, or configuration validity details.

## CORS

Disabled by default (server-to-server). Set `NODEGRAM_ALLOWED_ORIGINS` to a comma-separated list of exact HTTPS origins to enable. Preflight `OPTIONS` is answered only for matching origins. Responses include `Vary: Origin`.

## Size limits

Default max body: **750 KiB**. Hard ceiling: **900 KiB**. DigitalOcean Functions input/result limit is **1 MB**.
