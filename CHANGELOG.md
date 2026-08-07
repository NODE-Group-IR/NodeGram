# Changelog

All notable changes to NodeGram are documented in this file.

## [1.1.0] — 2026-08-07

### Changed

- Relay body now requires per-request Telegram `token` so every caller can use their own bot
- Gateway config (`NODEGRAM_CLIENTS_B64`) stores only client key hashes; bot aliases are no longer required
- Legacy `bot` alias field is rejected
- Docs/config aligned: no bot tokens in `clients.local.json`; `NODEGRAM_RATE_LIMIT` wired in `project.yml`; logs use numeric `bot_id` (`NODEGRAM_LOG_BOT_ID`); public API no longer documents unused `403 FORBIDDEN`
- Upstream completion outcomes distinguish `TELEGRAM_OK` / `TELEGRAM_CLIENT_ERROR` / `TELEGRAM_RATE_LIMITED` / `TELEGRAM_SERVER_ERROR` (passthrough HTTP status unchanged)
- Telegram response bodies are size-checked via `Content-Length` and enforced while streaming (900 KiB)
- GitHub Actions pinned to immutable commit SHAs
- Development dependency audit clean (`glob` via `@vitest/coverage-v8`)

## [1.0.0] — 2026-08-07

### Added

- Authenticated JSON envelope relay to the official Telegram Bot API
- DigitalOcean Functions `nodejs:22` + `web: raw` adapter
- Multi-client configuration via `NODEGRAM_CLIENTS_B64`
- Health endpoint, optional CORS allowlisting, best-effort warm-instance rate limit
- Vitest suite with ≥90% coverage target, CI, CodeQL, and deployment docs
