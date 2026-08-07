# Using NodeGram from Node.js

```bash
export NODEGRAM_URL="https://example.doserverless.co/api/v1/web/<namespace>/nodegram/gateway"
export NODEGRAM_API_KEY="ng_live_replace_me"
```

```js
const response = await fetch(process.env.NODEGRAM_URL, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.NODEGRAM_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    bot: "notifications",
    method: "sendMessage",
    params: { chat_id: process.env.TELEGRAM_TEST_CHAT_ID, text: "Hello from NodeGram" },
  }),
});

const result = await response.json();
if (!response.ok || result.ok === false) {
  throw new Error(JSON.stringify(result));
}
console.log(result);
```

See also [`examples/node`](../examples/node).
