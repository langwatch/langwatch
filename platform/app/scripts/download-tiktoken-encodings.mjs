#!/usr/bin/env node
/**
 * Downloads every tiktoken encoding file named in tiktoken's registry into one
 * directory, so the image can set TIKTOKENS_PATH and count tokens without a
 * runtime call to openaipublic.blob.core.windows.net. The tokenizer client
 * reads `<TIKTOKENS_PATH>/<basename of the registry URL>` before it fetches.
 *
 * Usage: node scripts/download-tiktoken-encodings.mjs <target-dir>
 */

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: download-tiktoken-encodings.mjs <target-dir>");
  process.exit(1);
}

const require = createRequire(import.meta.url);
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
  const file = path.join(target, path.basename(url));
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
  console.log(`${path.basename(url)} <- ${url}`);
}
