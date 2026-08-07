# Using NodeGram with cURL

```bash
export NODEGRAM_URL="https://example.doserverless.co/api/v1/web/<namespace>/nodegram/gateway"
export NODEGRAM_API_KEY="ng_live_replace_me"
export TELEGRAM_BOT_TOKEN="123456789:AA...your_bot_token..."
export TELEGRAM_TEST_CHAT_ID="123456789"
```

Health:

```bash
curl -sS "$NODEGRAM_URL?health=1"
```

`getMe`:

```bash
curl --request POST "$NODEGRAM_URL" \
  --header "Authorization: Bearer $NODEGRAM_API_KEY" \
  --header "Content-Type: application/json" \
  --data "{\"token\":\"$TELEGRAM_BOT_TOKEN\",\"method\":\"getMe\",\"params\":{}}"
```

`sendMessage`:

```bash
curl --request POST "$NODEGRAM_URL" \
  --header "Authorization: Bearer $NODEGRAM_API_KEY" \
  --header "Content-Type: application/json" \
  --data "{\"token\":\"$TELEGRAM_BOT_TOKEN\",\"method\":\"sendMessage\",\"params\":{\"chat_id\":\"$TELEGRAM_TEST_CHAT_ID\",\"text\":\"Hello from NodeGram\"}}"
```

See also [`examples/curl`](../examples/curl).
