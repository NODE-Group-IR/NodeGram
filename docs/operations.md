# Operations

## Monitoring

- Prefer DigitalOcean Functions activation logs and metrics.
- Expect exactly one structured JSON completion log per request with: timestamp, request_id, client_ref, optional `bot_id` (numeric Telegram bot id when `NODEGRAM_LOG_BOT_ID=true`), method, outcome, upstream_status, duration_ms, cold_start.
- Upstream passthrough outcomes (HTTP response received from Telegram; body still passed through unchanged):
  - `TELEGRAM_OK` — 2xx
  - `TELEGRAM_CLIENT_ERROR` — other 4xx (for example 400)
  - `TELEGRAM_RATE_LIMITED` — 429
  - `TELEGRAM_SERVER_ERROR` — 5xx
- Gateway/local outcomes remain error codes such as `UNAUTHORIZED`, `BAD_GATEWAY`, `GATEWAY_TIMEOUT`, `CONFIGURATION_ERROR`.
- Alert on elevated `CONFIGURATION_ERROR`, `UNAUTHORIZED`, `BAD_GATEWAY`, `GATEWAY_TIMEOUT`, `TELEGRAM_RATE_LIMITED`, and `TELEGRAM_SERVER_ERROR` rates. Do not treat `TELEGRAM_CLIENT_ERROR` as gateway health failure by default (often bad caller params).
- Do not scrape logs for chat IDs or message text — they are never logged by design. Bot token secrets are never logged; only an optional numeric `bot_id` prefix may appear.

## Rate limiting

`NODEGRAM_BURST` / `NODEGRAM_REFILL_PER_SECOND` implement a **best-effort warm-instance** token bucket.

- Not distributed across instances
- Not a security or billing quota boundary
- Disable with `NODEGRAM_RATE_LIMIT=off` (or `0` / `false`) or `NODEGRAM_BURST=0`
- These variables must be present in [`project.yml`](../project.yml) so `doctl` substitutes them into the Function

For strict global quotas, introduce a shared store (see [architecture](architecture.md)).

## Rotation

### Gateway client keys

See [deployment-digitalocean.md](deployment-digitalocean.md): `npm run keygen`, dual `keySha256` during cutover, update `NODEGRAM_CLIENTS_B64`, redeploy.

### Telegram bot tokens

Callers own their tokens. Rotate via BotFather and update the application’s `TELEGRAM_BOT_TOKEN` (or equivalent). **Do not** put bot tokens in `NODEGRAM_CLIENTS_B64` or `config/clients.local.json`. No Function redeploy is required for bot rotation.

## Incident response

1. Disable a compromised gateway client (`enabled: false`) or remove its hashes; redeploy immediately.
2. If a Telegram bot token may be exposed, revoke/rotate it in BotFather and update the affected application env — not the Function client config.
3. Review activation logs for outcome spikes only — never paste raw request bodies into tickets.
4. If the Function is abused as a public relay, rotate gateway keys and restrict network access at your application edge.

## Cost / limit awareness

- 1 MB input and 1 MB result limits on DigitalOcean Functions
- Conservative body limit (750 KiB default, ≤900 KiB hard cap)
- 30 s timeout / 256 MB memory defaults in `project.yml`
- Irregular traffic is usually inexpensive; watch cold starts and chatty `getUpdates` polling

## Safe troubleshooting

- Start with `?health=1`
- Use `getMe` before `sendMessage` (include the caller’s `token` in the body)
- Use private test chats only
- Never enable debug logging of bodies or Authorization headers
