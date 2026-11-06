import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { nowInstant } from "@langwatch/time";

import { GITHUB_ACCEPT, REPOSITORY_API_URL, starCount } from "../../../lib/github-repository.ts";
import { cacheRoot } from "../../../paths.ts";

const cacheFile = path.join(cacheRoot, "docs-site/stars.json");
/** A star count and when GitHub reported it, in epoch milliseconds; both null when unknown. */
export type StarsRead = { count: number | null; at: number | null };

let starsRead: Promise<StarsRead> | undefined;

/** The public star count, read once per process; the last known count if GitHub is down. */
export function readStars() {
  starsRead ??= fetchStars();
  return starsRead;
}

async function fetchStars(): Promise<StarsRead> {
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
    return { count: cached.count ?? null, at: cached.count == null ? null : (cached.at ?? null) };
  } catch {
    return { count: null, at: null };
  }
}
