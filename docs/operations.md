# Operations

## Monitoring

- Prefer DigitalOcean Functions activation logs and metrics.
- Expect exactly one structured JSON completion log per request with: timestamp, request_id, client_ref, optional bot_alias, method, outcome, upstream_status, duration_ms, cold_start.
- Alert on elevated `CONFIGURATION_ERROR`, `UNAUTHORIZED`, `BAD_GATEWAY`, and `GATEWAY_TIMEOUT` rates.
- Do not scrape logs for chat IDs or message text — they are never logged by design.

## Rate limiting

`NODEGRAM_BURST` / `NODEGRAM_REFILL_PER_SECOND` implement a **best-effort warm-instance** token bucket.

- Not distributed across instances
- Not a security or billing quota boundary
- Disable with `NODEGRAM_RATE_LIMIT=off` or `NODEGRAM_BURST=0`

For strict global quotas, introduce a shared store (see [architecture](architecture.md)).

## Rotation

See [deployment-digitalocean.md](deployment-digitalocean.md) for key and bot rotation steps.

## Incident response

1. Disable a compromised client (`enabled: false`) or remove its hashes; redeploy immediately.
2. Rotate Telegram bot tokens via BotFather if tokens may be exposed; update `NODEGRAM_CLIENTS_B64`.
3. Review activation logs for outcome spikes only — never paste raw request bodies into tickets.
4. If the Function is abused as a public relay, rotate keys and restrict network access at your application edge.

## Cost / limit awareness

- 1 MB input and 1 MB result limits on DigitalOcean Functions
- Conservative body limit (750 KiB default, ≤900 KiB hard cap)
- 30 s timeout / 256 MB memory defaults in `project.yml`
- Irregular traffic is usually inexpensive; watch cold starts and chatty `getUpdates` polling

## Safe troubleshooting

- Start with `?health=1`
- Use `getMe` before `sendMessage`
- Use private test chats only
- Never enable debug logging of bodies or Authorization headers
