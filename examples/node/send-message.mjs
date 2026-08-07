/**
 * NodeGram Node.js example — reads secrets from environment only.
 *
 *   export NODEGRAM_URL="https://..."
 *   export NODEGRAM_API_KEY="ng_live_replace_me"
 *   export TELEGRAM_TEST_CHAT_ID="123456789"
 *   node examples/node/send-message.mjs
 */
const url = process.env.NODEGRAM_URL;
const key = process.env.NODEGRAM_API_KEY;
const chatId = process.env.TELEGRAM_TEST_CHAT_ID;

if (!url || !key || !chatId) {
  console.error("Set NODEGRAM_URL, NODEGRAM_API_KEY, and TELEGRAM_TEST_CHAT_ID");
  process.exit(1);
}

const response = await fetch(url, {
  method: "POST",
  headers: {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    bot: "notifications",
    method: "sendMessage",
    params: { chat_id: chatId, text: "Hello from NodeGram" },
  }),
});

const text = await response.text();
console.log(response.status, text);
