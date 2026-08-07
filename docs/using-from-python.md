# Using NodeGram from Python

```bash
export NODEGRAM_URL="https://example.doserverless.co/api/v1/web/<namespace>/nodegram/gateway"
export NODEGRAM_API_KEY="ng_live_replace_me"
export TELEGRAM_BOT_TOKEN="123456789:AA...your_bot_token..."
export TELEGRAM_TEST_CHAT_ID="123456789"
```

```python
import os
import urllib.request
import json

payload = {
    "token": os.environ["TELEGRAM_BOT_TOKEN"],
    "method": "sendMessage",
    "params": {
        "chat_id": os.environ["TELEGRAM_TEST_CHAT_ID"],
        "text": "Hello from NodeGram",
    },
}

req = urllib.request.Request(
    os.environ["NODEGRAM_URL"],
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {os.environ['NODEGRAM_API_KEY']}",
        "Content-Type": "application/json",
    },
    method="POST",
)

with urllib.request.urlopen(req, timeout=20) as resp:
    print(resp.status)
    print(resp.read().decode("utf-8"))
```

See also [`examples/python`](../examples/python).
