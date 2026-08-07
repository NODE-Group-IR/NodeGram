#!/usr/bin/env bash
# Apply GitHub repo description and topics after the repo exists and you are logged in.
# Social preview has no public API — upload brand/cover.png once in Settings (see below).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="${GITHUB_REPOSITORY:-NODE-Group-IR/NodeGram}"
DESC='Secure serverless Telegram Bot API gateway — “Telegram reaches your code.”'

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found. Install: brew install gh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: not logged in. Run: gh auth login"
  exit 1
fi

echo "==> Setting description and homepage on $REPO"
gh repo edit "$REPO" \
  --description "$DESC" \
  --homepage "https://www.nodegroup.ir/"

echo "==> Setting topics"
gh repo edit "$REPO" \
  --add-topic telegram \
  --add-topic bot-api \
  --add-topic digitalocean \
  --add-topic serverless \
  --add-topic nodejs

echo
echo "Done (description + topics)."
echo
echo "Social preview (manual — GitHub has no API for this):"
echo "  1. Open https://github.com/${REPO}/settings"
echo "  2. Scroll to Social preview"
echo "  3. Upload: ${ROOT}/brand/cover.png"
echo
echo "Verify: https://github.com/${REPO}"
