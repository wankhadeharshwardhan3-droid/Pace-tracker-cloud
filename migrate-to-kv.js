// Run this once, locally, after downloading your export from the
// export-data.js Netlify function.
//
// Usage:
//   node migrate-to-kv.js pace-export.json kv-bulk-upload.json
//
// Then upload the result with:
//   wrangler kv bulk put --namespace-id <your-namespace-id> kv-bulk-upload.json

import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error("Usage: node migrate-to-kv.js <netlify-export.json> <kv-bulk-upload.json>");
  process.exit(1);
}

const exported = JSON.parse(readFileSync(inputPath, "utf-8"));

const entries = [];

// 1. The list of all registered names
entries.push({ key: "list", value: JSON.stringify(exported.list || []) });

// 2. Every account record (signup info, PIN hash, push subscription, webauthn credential)
for (const [key, value] of Object.entries(exported.accounts || {})) {
  entries.push({ key, value: JSON.stringify(value) });
}

// 3. Every data record (goal, entries, private flag)
for (const [key, value] of Object.entries(exported.data || {})) {
  entries.push({ key, value: JSON.stringify(value) });
}

writeFileSync(outputPath, JSON.stringify(entries, null, 2));

console.log(`Wrote ${entries.length} key-value pairs to ${outputPath}`);
console.log(`Covering ${(exported.list || []).length} user accounts.`);
console.log("");
console.log("Next step:");
console.log(`  wrangler kv bulk put --namespace-id <your-namespace-id> ${outputPath}`);
