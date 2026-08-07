#!/usr/bin/env node
/**
 * Generate a NodeGram client API key and its SHA-256 hash.
 * The plaintext is shown once and cannot be recovered from the hash.
 */
import { createHash, randomBytes } from "node:crypto";

const secret = randomBytes(32).toString("base64url");
const key = `ng_live_${secret}`;
const hash = createHash("sha256").update(key, "utf8").digest("hex");

console.log("NodeGram client key (store securely; shown once):");
console.log(key);
console.log("");
console.log("SHA-256 (lowercase hex) for NODEGRAM_CLIENTS_B64 config:");
console.log(hash);
console.log("");
console.log("WARNING: The plaintext key cannot be recovered from the hash. Rotate if lost.");
