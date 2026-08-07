#!/usr/bin/env bash
# NodeGram cURL helpers — secrets from environment only.
set -euo pipefail

: "${NODEGRAM_URL:?Set NODEGRAM_URL}"
: "${NODEGRAM_API_KEY:?Set NODEGRAM_API_KEY}"
: "${TELEGRAM_BOT_TOKEN:?Set TELEGRAM_BOT_TOKEN}"

echo "== health =="
curl -sS "${NODEGRAM_URL}?health=1"
echo

echo "== getMe =="
curl --request POST "$NODEGRAM_URL" \
  --header "Authorization: Bearer $NODEGRAM_API_KEY" \
  --header "Content-Type: application/json" \
  --data "{\"token\":\"${TELEGRAM_BOT_TOKEN}\",\"method\":\"getMe\",\"params\":{}}"
echo

if [[ -n "${TELEGRAM_TEST_CHAT_ID:-}" ]]; then
  echo "== sendMessage =="
  curl --request POST "$NODEGRAM_URL" \
    --header "Authorization: Bearer $NODEGRAM_API_KEY" \
    --header "Content-Type: application/json" \
    --data "{\"token\":\"${TELEGRAM_BOT_TOKEN}\",\"method\":\"sendMessage\",\"params\":{\"chat_id\":\"${TELEGRAM_TEST_CHAT_ID}\",\"text\":\"Hello from NodeGram\"}}"
  echo
fi
