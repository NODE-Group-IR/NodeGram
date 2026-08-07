# API contract

Base URL: your DigitalOcean Functions web URL for `nodegram/gateway`.

## `POST /` — relay

### Headers

```http
Authorization: Bearer ng_live_<gateway_secret>
Content-Type: application/json
```

The Bearer value is a **NodeGram gateway client key** (who may use the Function).  
The Telegram bot token is supplied in the JSON body so every caller can use their own bot.

Credentials for the gateway are accepted only in the `Authorization` header. Duplicate `Authorization` headers, query-string credentials, or alternate credential locations are rejected.

### Body

```json
{
  "token": "123456789:AA...your_bot_token...",
  "method": "sendMessage",
  "params": {
    "chat_id": "123456789",
    "text": "Hello from NodeGram"
  }
}
```

| Field    | Required | Rules                                                                                                                     |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `token`  | Yes      | Telegram bot token matching `^[0-9]{5,15}:[A-Za-z0-9_-]{20,100}$`. Must not contain `/`, `?`, `#`, or control characters. |
| `method` | Yes      | `^[A-Za-z][A-Za-z0-9]{0,63}$`                                                                                             |
| `params` | No       | Plain JSON object; default `{}`. Dangerous keys (`__proto__`, `prototype`, `constructor`) are rejected recursively.       |

The legacy field `bot` (alias) is rejected — use `token` on every call.

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

| Status | Code                                     | Meaning                                      |
| ------ | ---------------------------------------- | -------------------------------------------- |
| 400    | `INVALID_REQUEST`                        | Malformed envelope or validation failure     |
| 401    | `UNAUTHORIZED`                           | Missing/invalid/disabled gateway credentials |
| 405    | `METHOD_NOT_ALLOWED`                     | Non-POST (except health/CORS)                |
| 413    | `PAYLOAD_TOO_LARGE`                      | Body exceeds configured limit                |
| 415    | `UNSUPPORTED_MEDIA_TYPE`                 | Content-Type is not JSON                     |
| 429    | `RATE_LIMITED`                           | Best-effort local throttle                   |
| 500    | `CONFIGURATION_ERROR` / `INTERNAL_ERROR` | Config or unexpected failure                 |
| 502    | `BAD_GATEWAY`                            | Invalid/unavailable Telegram response        |
| 504    | `GATEWAY_TIMEOUT`                        | Upstream timed out                           |

v1.1 (bring-your-own-token) does not emit `403 FORBIDDEN`: after gateway authentication succeeds, any well-formed Telegram bot token may be used. Invalid or disabled gateway keys are always `401`.

## `GET /?health=1`

Returns service/version/runtime/timestamp (and optional build id). Does not call Telegram. Does not expose client IDs, tokens, or configuration details.

## CORS

Disabled by default. Set `NODEGRAM_ALLOWED_ORIGINS` to comma-separated exact HTTPS origins (use `none` in `.env` when unused — doctl cannot template empty strings).

## Size limits

Default max body: **750 KiB**. Hard ceiling: **900 KiB**. DigitalOcean Functions input/result limit is **1 MB**.
