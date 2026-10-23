import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

/* Gzip bytes an island downloads before it can answer its first click: its entry and every
   chunk that entry imports. Measured 2026-10-23 on Preact; a little headroom above each.
   Search grew by its result icons the same day. */
export const INTERACTION_BUDGETS = {
  contextMenusInteractionGzip: 95_000,
  searchInteractionGzip: 86_000,
  playgroundInteractionGzip: 24_500,
};
const ISLAND_OF = {
  contextMenusInteractionGzip: "context-menus",
  searchInteractionGzip: "search",
  playgroundInteractionGzip: "playground",
};

export async function readManifest({ directory }) {
  return JSON.parse(await readFile(path.join(directory, ".vite/manifest.json"), "utf8"));
}

/** The output files an island entry loads, itself first, each once. */
export function entryFiles({ manifest, name }) {
  const found = Object.entries(manifest).find(([, entry]) => entry.name === name && entry.isEntry);
  if (!found) return [];
  const result = new Set();
  const collect = (key) => {
    const entry = manifest[key];
    if (!entry || result.has(entry.file)) return;
    result.add(entry.file);
    for (const child of entry.imports ?? []) collect(child);
  };
  collect(found[0]);
  return [...result];
}

export async function gzipFiles({ directory, files }) {
  let bytes = 0;
  for (const file of new Set(files))
    bytes += gzipSync(await readFile(path.join(directory, file))).length;
  return bytes;
}

export async function interactionSizes({ directory, manifest }) {
  const sizes = {};
  for (const [field, name] of Object.entries(ISLAND_OF))
    sizes[field] = await gzipFiles({ directory, files: entryFiles({ manifest, name }) });
  return sizes;
}
