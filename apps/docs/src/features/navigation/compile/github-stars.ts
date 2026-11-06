import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { nowInstant } from "@langwatch/time";

import { GITHUB_ACCEPT, REPOSITORY_API_URL, starCount } from "../../../lib/github-repository.ts";
import { cacheRoot } from "../../../paths.ts";

const defaultCacheFile = path.join(cacheRoot, "docs-site/stars.json");
/** A star count and when GitHub reported it, in epoch milliseconds; both null when unknown. */
export type StarsRead = { count: number | null; at: number | null };

let starsRead: Promise<StarsRead> | undefined;

/** The public star count, read once per process; the last known count if GitHub is down. */
export function readStars() {
  starsRead ??= fetchStars({ cacheFile: defaultCacheFile });
  return starsRead;
}

/** Asks GitHub for the count and keeps it in `cacheFile`; reads that back if GitHub fails. */
export async function fetchStars({ cacheFile }: { cacheFile: string }): Promise<StarsRead> {
  try {
    const response = await fetch(REPOSITORY_API_URL, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: GITHUB_ACCEPT },
    });
    const count = starCount({ body: await response.json() });
    if (response.ok && count !== null) {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      const read = { count, at: nowInstant().epochMilliseconds };
      writeFileSync(cacheFile, JSON.stringify(read));
      return read;
    }
  } catch {
    // Fall back to the last successful public count.
  }
  try {
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    const count = Number.isInteger(cached.count) ? (cached.count as number) : null;
    const at = count !== null && Number.isFinite(cached.at) ? (cached.at as number) : null;
    return { count, at };
  } catch {
    return { count: null, at: null };
  }
}
