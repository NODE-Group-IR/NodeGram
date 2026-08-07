# Using NodeGram from PHP

```bash
export NODEGRAM_URL="https://example.doserverless.co/api/v1/web/<namespace>/nodegram/gateway"
export NODEGRAM_API_KEY="ng_live_replace_me"
export TELEGRAM_TEST_CHAT_ID="123456789"
```

```php
<?php
$payload = json_encode([
    'bot' => 'notifications',
    'method' => 'sendMessage',
    'params' => [
        'chat_id' => getenv('TELEGRAM_TEST_CHAT_ID'),
        'text' => 'Hello from NodeGram',
    ],
]);

$ch = curl_init(getenv('NODEGRAM_URL'));
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . getenv('NODEGRAM_API_KEY'),
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => $payload,
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo $status, PHP_EOL, $body, PHP_EOL;
```

See also [`examples/php`](../examples/php).
