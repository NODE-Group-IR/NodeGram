#!/usr/bin/env node
/**
 * Fail CI if obvious live-looking secrets appear in committed artifacts.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const roots = [
  "packages/nodegram/gateway/bundle.js",
  "config/clients.example.json",
  "examples",
  ".env.example",
];

const patterns = [
  { name: "live_ng_key", re: /ng_live_[A-Za-z0-9_-]{20,}/g },
  { name: "telegram_token_like", re: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g },
];

const allowlist = new Set([
  // Example placeholders only
  "000000000:EXAMPLE_BOT_TOKEN_REPLACE_ME_NOT_REAL",
]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  const st = statSync(dir);
  if (st.isFile()) {
    out.push(dir);
    return out;
  }
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    walk(join(dir, name), out);
  }
  return out;
}

let failed = false;
for (const rel of roots) {
  const abs = join(root, rel);
  for (const file of walk(abs)) {
    if (
      !/\.(js|json|md|ts|mjs|sh|yml|yaml|env|txt|php|py)$/i.test(file) &&
      !file.endsWith("bundle.js")
    ) {
      continue;
    }
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const { name, re } of patterns) {
      re.lastIndex = 0;
      const matches = text.match(re) ?? [];
      for (const m of matches) {
        if (allowlist.has(m)) continue;
        // Allow README/docs examples that use REPLACE_ME / replace_me
        if (/replace/i.test(m) || /EXAMPLE/i.test(m) || /YOUR_/i.test(m)) continue;
        if (m.includes("REPLACE_ME") || m.includes("replace_me")) continue;
        console.error(
          `Secret-like pattern (${name}) in ${relative(root, file)}: ${m.slice(0, 24)}...`,
        );
        failed = true;
      }
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log("secret-scan: ok");
