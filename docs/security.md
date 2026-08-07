# Security model

## Threat model (v1.1)

| Threat                | Mitigation                                                                            |
| --------------------- | ------------------------------------------------------------------------------------- |
| Open proxy / SSRF     | Hard-coded `https://api.telegram.org`; no client-controlled scheme/host/port/base URL |
| Anonymous abuse       | Require revocable gateway Bearer keys (hashed at rest in Function config)             |
| Stolen gateway key    | Store only SHA-256 hashes; constant-time compare; rotate with two hashes              |
| Bot-token exposure    | Never log tokens; never accept tokens in URL/query; apps store their own tokens       |
| Oversized payload     | Reject declared and actual decoded sizes before upstream                              |
| Hanging upstream      | `AbortController` timeout capped below Function deadline                              |
| Redirect attack       | `redirect: "error"`                                                                   |
| Secret-bearing errors | Stable sanitized codes only                                                           |
| Timing leak           | Dummy digest + `crypto.timingSafeEqual`                                               |
| Prototype pollution   | Reject dangerous keys recursively                                                     |

## Operator checklist

- [ ] Generate gateway keys with `npm run keygen`; store plaintext only in your secret manager
- [ ] Put only key hashes in `NODEGRAM_CLIENTS_B64`
- [ ] Each app keeps its own Telegram bot token as `TELEGRAM_BOT_TOKEN` (or equivalent) and sends it per request
- [ ] Keep `.env` and `clients.local.json` out of Git
- [ ] Do not enable permissive CORS (`*`) with Authorization
- [ ] Treat the in-memory limiter as best-effort only
- [ ] Never paste tokens, keys, chat IDs, or message bodies into issues or logs

## TLS

Client-to-NodeGram TLS terminates at DigitalOcean. NodeGram-to-Telegram uses HTTPS to the fixed official origin.

## Media limitation

Do not send multipart binary uploads through NodeGram. Use `file_id` or a public HTTPS URL. See [ADR 0002](adr/0002-no-binary-proxy.md).

## Independence

NodeGram is independent open-source software by [NODE Group](https://www.nodegroup.ir/). It is not affiliated with or endorsed by Telegram or DigitalOcean.
