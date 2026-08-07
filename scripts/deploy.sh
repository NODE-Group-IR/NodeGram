#!/usr/bin/env bash
# Deploy NodeGram to the connected DigitalOcean Functions namespace.
# Does NOT install doctl, authenticate, or create billable resources beyond the deploy you request.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Running full check"
npm run check

if [[ -f .env ]]; then
  if git ls-files --error-unmatch .env >/dev/null 2>&1; then
    echo "ERROR: .env is tracked by git. Remove it from the index before deploying."
    exit 1
  fi
  echo "==> .env is present and untracked (ok)"
else
  echo "WARNING: No .env found. Ensure NODEGRAM_* secrets are available to doctl templating."
fi

if ! command -v doctl >/dev/null 2>&1; then
  echo "ERROR: doctl not found on PATH. Install and authenticate separately, then re-run."
  exit 1
fi

echo "==> Deploying with doctl serverless deploy . --remote-build"
doctl serverless deploy . --remote-build

echo "==> Function URL:"
doctl serverless functions get nodegram/gateway --url || true

echo "Deploy finished. Smoke-test GET ?health=1 then a getMe relay before production traffic."
