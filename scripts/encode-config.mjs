#!/usr/bin/env node
/**
 * Validate a non-secret clients JSON file and print one-line base64 for NODEGRAM_CLIENTS_B64.
 * Never modifies files. Do not pass files containing live secrets into version control.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pathArg = process.argv[2];
if (!pathArg) {
  console.error("Usage: node scripts/encode-config.mjs <path-to-clients.json>");
  process.exit(1);
}

const filePath = resolve(pathArg);
let raw;
try {
  raw = readFileSync(filePath, "utf8");
} catch (err) {
  console.error(`Cannot read ${filePath}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(raw);
} catch {
  console.error("Invalid JSON");
  process.exit(1);
}

function fail(msg) {
  console.error(`Validation failed: ${msg}`);
  process.exit(1);
}

if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
  fail("root must be object");
}
if (doc.schemaVersion !== 1) {
  fail("schemaVersion must be 1");
}
if (!Array.isArray(doc.clients) || doc.clients.length < 1) {
  fail("clients must be a non-empty array");
}

const HASH = /^[a-f0-9]{64}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOKEN = /^[0-9]{5,15}:[A-Za-z0-9_-]{20,100}$/;
const ids = new Set();

for (const c of doc.clients) {
  if (!c || typeof c !== "object") fail("client must be object");
  if (typeof c.id !== "string" || !ID.test(c.id)) fail("invalid client id");
  if (ids.has(c.id)) fail(`duplicate client id ${c.id}`);
  ids.add(c.id);

  const hashes = Array.isArray(c.keySha256) ? c.keySha256 : [c.keySha256];
  if (hashes.length < 1 || hashes.length > 2) fail("keySha256 must be 1 or 2 hashes");
  for (const h of hashes) {
    if (typeof h !== "string" || !HASH.test(h)) fail("invalid keySha256");
  }

  // bots is optional/legacy — callers supply Telegram tokens per request
  if (c.bots !== undefined && c.bots !== null) {
    if (typeof c.bots !== "object" || Array.isArray(c.bots)) fail("bots must be an object if set");
    for (const [alias, token] of Object.entries(c.bots)) {
      if (!ALIAS.test(alias)) fail(`invalid bot alias ${alias}`);
      if (typeof token !== "string" || !TOKEN.test(token)) fail(`invalid token shape for ${alias}`);
    }
  }
  if (typeof c.enabled !== "boolean") fail("enabled must be boolean");
}

const b64 = Buffer.from(JSON.stringify(doc), "utf8").toString("base64");
process.stdout.write(`${b64}\n`);
