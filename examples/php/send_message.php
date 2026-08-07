<?php
/**
 * NodeGram PHP example — reads secrets from environment only.
 */
$url = getenv('NODEGRAM_URL');
$key = getenv('NODEGRAM_API_KEY');
$chatId = getenv('TELEGRAM_TEST_CHAT_ID');

if (!$url || !$key || !$chatId) {
    fwrite(STDERR, "Set NODEGRAM_URL, NODEGRAM_API_KEY, and TELEGRAM_TEST_CHAT_ID\n");
    exit(1);
}

$payload = json_encode([
    'bot' => 'notifications',
    'method' => 'sendMessage',
    'params' => ['chat_id' => $chatId, 'text' => 'Hello from NodeGram'],
]);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $key,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => $payload,
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo $status, PHP_EOL, $body, PHP_EOL;
