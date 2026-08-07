# ADR 0002: No binary proxy in v1

## Status

Accepted (v1)

## Context

DigitalOcean Functions limits input parameters and result responses to **1 MB**. Raw/base64 web handling further reduces usable binary capacity. Multipart Telegram uploads and `getFile` download proxying would exceed these limits or force unsafe workarounds.

## Decision

NodeGram v1 supports JSON parameters only. Media should use:

- existing Telegram `file_id` values, or
- public HTTPS URLs Telegram can fetch

Large binary transfer or webhook fan-out belongs on a separate streaming service (for example DigitalOcean App Platform), not this Function.

## Consequences

- Predictable payload sizes and simpler threat model
- No multipart parsing surface in the Function
- Operators must stage media outside NodeGram when uploading new files
