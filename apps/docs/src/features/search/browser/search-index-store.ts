import { z } from "zod/mini";

import { sitePath } from "../../../lib/site-path.ts";
import { indexEntries, searchEntrySchema } from "../model/search-entry.ts";
import type { IndexedEntry } from "../model/search-entry.ts";

let loaded: { build: string; entries: Promise<IndexedEntry[]> } | undefined;

/** The build this page came from: a soft navigation never crosses builds, so it keys the index. */
export function currentBuild() {
  return document.querySelector<HTMLMetaElement>('meta[name="docs-build"]')?.content ?? "dev";
}

/**
 * Fetches, validates and lowercases the index once per build; a failed load is forgotten so retry
 * refetches. `?v=<build>` is the one query the service worker caches, so search works offline.
 */
export function loadSearchIndex({ build }: { build: string }): Promise<IndexedEntry[]> {
  if (loaded?.build === build) return loaded.entries;
  const url = sitePath({ path: `/search-index.json?v=${encodeURIComponent(build)}` });
  const entries = fetch(url, { credentials: "omit" }).then(async (response) => {
    if (!response.ok) throw new Error("Search unavailable");
    return indexEntries({ entries: z.array(searchEntrySchema).parse(await response.json()) });
  });
  loaded = { build, entries };
  entries.catch(() => {
    if (loaded?.entries === entries) loaded = void 0;
  });
  return entries;
}
