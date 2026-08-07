# Contributing to NodeGram

Thanks for helping improve NodeGram, an open-source project by [NODE Group](https://www.nodegroup.ir/).

## Development setup

```bash
npm ci
npm run check
```

Requires Node.js 22+.

## Workflow

1. Fork and create a branch
2. Keep changes focused; match existing module boundaries under `packages/nodegram/gateway/src/`
3. Add or update Vitest coverage for behavior changes
4. Run `npm run check` (format, lint, typecheck, coverage, build, secret scan)
5. Open a pull request using the template

## Security-sensitive changes

- Never commit `.env`, `clients.local.json`, live keys, or bot tokens
- Do not add runtime dependencies without strong justification (cold start + supply chain)
- Do not introduce arbitrary upstream URL forwarding
- Preserve constant-time auth and log redaction tests

## Code style

- TypeScript strict mode
- Prettier + ESLint flat config
- No `eval`, dynamic input-based imports, or shell execution

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
