import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { nowInstant } from "@langwatch/time";
import { loadEnv } from "vite";

import { GITHUB_ACCEPT, REPOSITORY_API_URL, starCount } from "../../../lib/github-repository.ts";
import { appRoot, cacheRoot } from "../../../paths.ts";

const defaultCacheFile = path.join(cacheRoot, "docs-site/stars.json");
/** A star count and when GitHub reported it, in epoch milliseconds; both null when unknown. */
export type StarsRead = { count: number | null; at: number | null };

let starsRead: Promise<StarsRead> | undefined;

/** The public star count, read once per process; the last known count if GitHub is down. */
export function readStars() {
  /* CI passes the workflow's token; a local build asks unsigned. Read once, with the count. */
  starsRead ??= fetchStars({
    cacheFile: defaultCacheFile,
    token: loadEnv("production", appRoot, "GITHUB_TOKEN").GITHUB_TOKEN,
  });
  return starsRead;
}

/**
 * Asks GitHub for the count and keeps it in `cacheFile`; reads that back if GitHub fails. A
 * `token` signs the request, since GitHub refuses many anonymous ones from shared CI addresses.
 */
export async function fetchStars({
  cacheFile,
  token,
}: {
  cacheFile: string;
  token?: string;
}): Promise<StarsRead> {
  let failure = "";
  try {
    const response = await fetch(REPOSITORY_API_URL, {
      /* The build reads this while it encodes media, which can stall a short wait. */
      signal: AbortSignal.timeout(20_000),
      headers: { accept: GITHUB_ACCEPT, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const count = starCount({ body: await response.json() });
    if (response.ok && count !== null) {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      const read = { count, at: nowInstant().epochMilliseconds };
      writeFileSync(cacheFile, JSON.stringify(read));
      return read;
    }
    failure = `GitHub answered ${response.status}`;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  console.warn(`[docs-site] star count not read (${failure}); using the last one kept`);
  try {
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    const count = Number.isInteger(cached.count) ? (cached.count as number) : null;
    const at = count !== null && Number.isFinite(cached.at) ? (cached.at as number) : null;
    return { count, at };
  } catch {
    return { count: null, at: null };
  }
}
