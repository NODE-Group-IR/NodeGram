# ADR 0003: Static secret configuration

## Status

Accepted (v1)

## Context

v1 must be deployable with minimal moving parts: no database, no control-plane service, and fast cold starts. Operators already manage DigitalOcean encrypted environment variables / `.env` for `doctl`.

## Decision

Client key hashes and bot tokens are supplied as a base64-encoded JSON document in `NODEGRAM_CLIENTS_B64`. The Function decodes, validates, deep-freezes, and caches the document per warm instance.

Base64 avoids shell quoting mistakes; it is **not** encryption. Encryption is provided by the platform secret store.

## Consequences

- Simple operations and low supply-chain risk
- Config changes require redeploy (or secret update + cold start)
- Path to a shared control plane (v2 candidate): replace `loadGatewayConfig` with a signed fetch from an admin service while keeping the same runtime `GatewayConfig` shape
- Rotation uses one or two `keySha256` values per client without a database
