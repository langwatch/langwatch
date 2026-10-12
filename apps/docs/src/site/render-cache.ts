import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import { searchEntrySchema } from "../features/search/model/search-entry.ts";

/* A search entry is checked against the search model's own schema but kept as published,
   so a cached page and a freshly rendered one produce the same search-index.json bytes. */
const publishedSearchEntry = z
  .json()
  .refine((value) => z.validate(searchEntrySchema, value), "not a search index entry");

/** A rendered page before the shared stylesheet and offline version are known. */
export const renderedPageSchema = z.object({
  page: z.string(),
  rules: z.array(z.string()),
  search: publishedSearchEntry.nullable(),
});
export type RenderedPage = z.infer<typeof renderedPageSchema>;

const storedSchema = z.object({ digest: z.string(), entry: z.string() });
const KEY = /^[0-9a-f]{64}$/;
const STALE_PARTIAL_MS = 60 * 60 * 1000;
/* Unused entries live this long, so builds of other branches or base paths sharing the cache
   (CI, haven, a root and a mounted build) keep theirs between runs. */
const STALE_ENTRY_MS = 7 * 24 * 60 * 60 * 1000;

function digestOf({ text }: { text: string }) {
  return createHash("sha256").update(text).digest("hex");
}

function entryFile({ directory, key }: { directory: string; key: string }) {
  if (!KEY.test(key)) throw new Error(`Render cache key is not a sha256 digest: ${key}`);
  return path.join(directory, `${key}.json`);
}

/** The stored page, or null when it is missing, unparsable or does not match its digest. */
async function readEntry({ file }: { file: string }): Promise<RenderedPage | null> {
  try {
    const stored = storedSchema.parse(JSON.parse(await readFile(file, "utf8")));
    const intact = digestOf({ text: stored.entry }) === stored.digest;
    return intact ? renderedPageSchema.parse(JSON.parse(stored.entry)) : null;
  } catch {
    return null;
  }
}

/** Whether a file was last written or used longer ago than `maxAge`. */
async function isOlderThan({ file, maxAge }: { file: string; maxAge: number }) {
  const written = await stat(file).catch(() => null);
  if (!written) return false;
  return nowInstant().epochMilliseconds - written.mtimeMs > maxAge;
}

async function pruneEntries({ directory, used }: { directory: string; used: Set<string> }) {
  for (const name of await readdir(directory).catch(() => [])) {
    const file = path.join(directory, name);
    const partial = name.endsWith(".partial");
    if (!partial && used.has(name.replace(/\.json$/, ""))) continue;
    const maxAge = partial ? STALE_PARTIAL_MS : STALE_ENTRY_MS;
    if (await isOlderThan({ file, maxAge })) await rm(file, { force: true });
  }
}

/**
 * Content-addressed rendered pages. Entries are named only by their own sha256 key, carry a
 * digest of their contents, and are written by rename; a missing, corrupt or mismatched entry
 * reads as a miss and the page is rendered again.
 */
export function renderCache({ directory }: { directory: string | null }) {
  const used = new Set<string>();
  return {
    async read({ key }: { key: string }): Promise<RenderedPage | null> {
      if (!directory) return null;
      used.add(key);
      const file = entryFile({ directory, key });
      const page = await readEntry({ file });
      const now = nowInstant().epochMilliseconds / 1000;
      if (page) await utimes(file, now, now).catch(() => undefined);
      return page;
    },
    async write({ key, page }: { key: string; page: RenderedPage }) {
      if (!directory) return;
      const target = entryFile({ directory, key });
      used.add(key);
      await mkdir(directory, { recursive: true });
      const entry = JSON.stringify(page);
      const partial = `${target}.${process.pid}.partial`;
      await writeFile(partial, JSON.stringify({ digest: digestOf({ text: entry }), entry }));
      await rename(partial, target);
    },
    /** Removes abandoned partial writes and entries no build has used for a week. */
    async prune() {
      if (directory) await pruneEntries({ directory, used });
    },
  };
}
