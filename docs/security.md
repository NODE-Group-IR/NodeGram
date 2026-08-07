# Security model

## Threat model (v1)

| Threat                    | Mitigation                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Open proxy / SSRF         | Hard-coded `https://api.telegram.org`; no client-controlled scheme/host/port/base URL                    |
| Stolen client key         | Store only SHA-256 hashes; constant-time compare; per-project keys; rotation with two hashes             |
| Bot-token exposure        | Tokens only in Function secret config; never in client URLs, bodies, or logs                             |
| Cross-tenant access       | Authenticate first; aliases exist only inside that client's bot map; identical `403` for missing aliases |
| Oversized payload         | Reject declared and actual decoded sizes before upstream                                                 |
| Hanging upstream          | `AbortController` timeout capped below Function deadline                                                 |
| Redirect attack           | `redirect: "error"`                                                                                      |
| Secret-bearing errors     | Stable sanitized codes only                                                                              |
| Timing leak               | Dummy digest + `crypto.timingSafeEqual`                                                                  |
| Prototype pollution       | Reject dangerous keys recursively                                                                        |
| Supply chain / cold start | Zero runtime dependencies                                                                                |

## Operator checklist

- [ ] Generate keys with `npm run keygen`; store plaintext only in your secret manager
- [ ] Put only hashes and bot tokens in `NODEGRAM_CLIENTS_B64` (encrypted Function/env secret)
- [ ] Keep `.env` and `config/clients.local.json` out of Git
- [ ] Use separate client keys per environment/project
- [ ] Rotate compromised keys immediately; temporarily accept two hashes during rotation
- [ ] Do not enable permissive CORS (`*`) with Authorization
- [ ] Treat the in-memory limiter as best-effort only — not a quota boundary
- [ ] Never paste tokens, keys, chat IDs, or message bodies into issues or logs
- [ ] Confirm health and `getMe` in a private test chat before production traffic
- [ ] Prefer CLI/`project.yml` configuration; dashboard edits may be overwritten on redeploy

## TLS

Client-to-NodeGram TLS terminates at DigitalOcean. NodeGram-to-Telegram uses HTTPS to the fixed official origin.

## Media limitation

Do not send multipart binary uploads through NodeGram v1. Use `file_id` or a public HTTPS URL Telegram can fetch. See [ADR 0002](adr/0002-no-binary-proxy.md).

## Independence

NodeGram is independent open-source software by [NODE Group](https://www.nodegroup.ir/). It is not affiliated with or endorsed by Telegram or DigitalOcean.
