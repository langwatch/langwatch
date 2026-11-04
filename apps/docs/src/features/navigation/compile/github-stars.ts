import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cacheRoot } from "../../../paths.ts";

const STARS_URL = "https://api.github.com/repos/langwatch/langwatch";
const cacheFile = path.join(cacheRoot, "docs-site/stars.json");
let starsRead: Promise<number | null> | undefined;

/** The public star count, read once per process; the last known count if GitHub is down. */
export function readStars() {
  starsRead ??= fetchStars();
  return starsRead;
}

async function fetchStars(): Promise<number | null> {
  try {
    const response = await fetch(STARS_URL, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: "application/vnd.github+json" },
    });
    const count = (await response.json()).stargazers_count;
    if (response.ok && Number.isInteger(count)) {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ count }));
      return count;
    }
  } catch {
    // Fall back to the last successful public count.
  }
  try {
    return JSON.parse(readFileSync(cacheFile, "utf8")).count ?? null;
  } catch {
    return null;
  }
}
