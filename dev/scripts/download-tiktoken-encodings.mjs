#!/usr/bin/env node
/**
 * Downloads every tiktoken encoding file into <target-dir> for TIKTOKENS_PATH,
 * each checked against a pinned SHA-256. Run from an app that depends on
 * tiktoken (apps/worker): `node ../../dev/scripts/download-tiktoken-encodings.mjs <dir>`.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: download-tiktoken-encodings.mjs <target-dir>");
  process.exit(1);
}

/** SHA-256 of every file tiktoken's registry names, by file name. */
const PINNED_SHA256 = {
  "vocab.bpe": "1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5",
  "encoder.json": "196139668be63f3b5d6574427317ae82f612a97c5d1cdaf36ed2256dbf636783",
  "r50k_base.tiktoken": "306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930",
  "p50k_base.tiktoken": "94b5ca7dff4d00767bc256fdd1b27e5b17361d7b8a5f968547f9f23eb70d2069",
  "cl100k_base.tiktoken": "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7",
  "o200k_base.tiktoken": "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d",
};

const require = createRequire(path.join(process.cwd(), "package.json"));
const registry = require("tiktoken/registry.json");

/** @type {Set<string>} */
const urls = new Set();
/** @param {Record<string, unknown>} node */
const collect = (node) => {
  for (const value of Object.values(node)) {
    if (typeof value === "string" && value.startsWith("https://")) {
      urls.add(value);
    } else if (value && typeof value === "object") {
      collect(/** @type {Record<string, unknown>} */ (value));
    }
  }
};
collect(registry);

await fs.mkdir(target, { recursive: true });
for (const url of urls) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const name = path.basename(url);
  const expected = /** @type {Record<string, string>} */ (PINNED_SHA256)[name];
  if (!expected) {
    throw new Error(`${name} has no pinned SHA-256; add it to PINNED_SHA256`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== expected) {
    throw new Error(`${name}: SHA-256 ${actual}, expected ${expected}`);
  }
  const file = path.join(target, name);
  await fs.writeFile(file, body);
  console.log(`${path.basename(url)} <- ${url}`);
}
