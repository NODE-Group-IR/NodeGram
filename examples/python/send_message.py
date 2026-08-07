#!/usr/bin/env python3
"""NodeGram Python example — reads secrets from environment only."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    url = os.environ.get("NODEGRAM_URL")
    key = os.environ.get("NODEGRAM_API_KEY")
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_TEST_CHAT_ID")
    if not url or not key or not token or not chat_id:
        print(
            "Set NODEGRAM_URL, NODEGRAM_API_KEY, TELEGRAM_BOT_TOKEN, and TELEGRAM_TEST_CHAT_ID",
            file=sys.stderr,
        )
        return 1

    payload = {
        "token": token,
        "method": "sendMessage",
        "params": {"chat_id": chat_id, "text": "Hello from NodeGram"},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            print(resp.status)
            print(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        print(err.code)
        print(err.read().decode("utf-8"))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
