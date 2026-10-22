import { sitePath } from "../../../lib/site-path.ts";
import { decodeSearchIndex, type SearchIndex } from "../model/search-engine.ts";

let loaded: { build: string; index: Promise<SearchIndex> } | undefined;

/** The build this page came from: a soft navigation never crosses builds, so it keys the index. */
export function currentBuild() {
  return document.querySelector<HTMLMetaElement>('meta[name="docs-build"]')?.content ?? "dev";
}

/**
 * Fetches and decodes the index once per build; a failed load is forgotten so retry
 * refetches. `?v=<build>` is the one query the service worker caches, so search works offline.
 */
export function loadSearchIndex({ build }: { build: string }): Promise<SearchIndex> {
  if (loaded?.build === build) return loaded.index;
  const url = sitePath({ path: `/search-index.json?v=${encodeURIComponent(build)}` });
  const index = fetch(url, { credentials: "omit" }).then(async (response) => {
    if (!response.ok) throw new Error("Search unavailable");
    return decodeSearchIndex({ data: await response.json() });
  });
  loaded = { build, index };
  index.catch(() => {
    if (loaded?.index === index) loaded = void 0;
  });
  return index;
}
