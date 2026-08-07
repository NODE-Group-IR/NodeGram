# Deploy NodeGram on DigitalOcean Functions

Every command below uses placeholders. Replace them with your values. Do not paste live tokens into tickets or chat.

## Prerequisites

- Node.js 22+
- `doctl` installed and authenticated (`doctl auth init`)
- Serverless support installed: `doctl serverless install`
- A Functions namespace in a region that can reach Telegram and your application hosts

CLI-managed settings belong in [`project.yml`](../project.yml). Dashboard edits may be overwritten on the next `doctl serverless deploy`.

## 1. Create / connect namespace

```bash
doctl serverless namespaces list
doctl serverless namespaces create --label nodegram-prod --region <REGION>
doctl serverless connect <namespace-label-or-uuid>
```

Use a current namespace **access key**. DigitalOcean deprecated the legacy shared namespace token (removal scheduled for June 2026).

## 2. Configure secrets

```bash
cp .env.example .env
npm run keygen
# edit config/clients.local.json with keySha256 hashes and bot tokens
node scripts/encode-config.mjs config/clients.local.json
# paste the one-line base64 into NODEGRAM_CLIENTS_B64 in .env
```

Suggested `.env` values:

| Variable                      | Example                            |
| ----------------------------- | ---------------------------------- |
| `NODEGRAM_CLIENTS_B64`        | output of encode-config            |
| `NODEGRAM_REQUEST_TIMEOUT_MS` | `20000`                            |
| `NODEGRAM_MAX_BODY_BYTES`     | `768000`                           |
| `NODEGRAM_ALLOWED_ORIGINS`    | empty or `https://app.example.com` |
| `NODEGRAM_BURST`              | `30` (or `0` to disable limiter)   |
| `NODEGRAM_REFILL_PER_SECOND`  | `5`                                |
| `NODEGRAM_LOG_BOT_ALIAS`      | `false`                            |
| `NODEGRAM_BUILD_ID`           | `git-sha-or-release`               |

`.env` must remain untracked.

## 3. Verify locally

```bash
npm ci
npm run check
```

## 4. Deploy

```bash
./scripts/deploy.sh
# or:
doctl serverless deploy . --remote-build
doctl serverless functions get nodegram/gateway --url
```

Record the URL as `NODEGRAM_URL`.

## 5. Health check

```bash
curl -sS "$NODEGRAM_URL?health=1"
```

Expect `"ok": true` with service/version only.

## 6. Smoke test `getMe`

```bash
curl --request POST "$NODEGRAM_URL" \
  --header "Authorization: Bearer $NODEGRAM_API_KEY" \
  --header "Content-Type: application/json" \
  --data "{\"token\":\"$TELEGRAM_BOT_TOKEN\",\"method\":\"getMe\",\"params\":{}}"
```

Then `sendMessage` to a **private test chat** only (include the same `token` field).

## 7. Activation logs

```bash
doctl serverless activations list --limit 20
doctl serverless activations get <activation-id>
doctl serverless activations logs <activation-id>
```

Logs must never contain tokens, keys, chat IDs, or message text.

## 8. Key and bot rotation

1. `npm run keygen` for a new key.
2. Add the new hash as a second `keySha256` entry (array of two).
3. Redeploy; migrate callers; remove the old hash; redeploy again.
4. For bots: each app rotates its own `TELEGRAM_BOT_TOKEN` locally — no Function redeploy required.

## 9. Rollback / redeploy

Redeploy a known-good git tag:

```bash
git checkout <known-good-tag>
npm ci && npm run check
doctl serverless deploy . --remote-build
```

## Troubleshooting

| Symptom               | Check                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| `CONFIGURATION_ERROR` | `NODEGRAM_CLIENTS_B64` present, valid base64 JSON, schemaVersion 1                      |
| `UNAUTHORIZED`        | Bearer key matches a configured hash; client `enabled: true`                            |
| `FORBIDDEN`           | Authenticated client not allowed for this action                                        |
| `504` / timeouts      | Lower Telegram `timeout` for `getUpdates`; raise Function timeout only within DO limits |
| `413`                 | Payload under 750 KiB default / 900 KiB hard cap; remember 1 MB platform limit          |
| CORS failures         | Exact HTTPS origin in `NODEGRAM_ALLOWED_ORIGINS`                                        |

## Cost and limits awareness

- Function input/result: **1 MB** each
- Memory: 256 MB; timeout: 30 s (as configured)
- No automatic retries of Telegram mutations
- Best-effort in-memory rate limit is not distributed
