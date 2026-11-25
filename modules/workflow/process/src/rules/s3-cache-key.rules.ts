import { createHash } from "node:crypto";

import type { Instant } from "@langwatch/time";

/** The header the engine reads the per-project studio cache key from. */
export const S3_CACHE_KEY_HEADER = "X-S3-Cache-Key";

/**
 * Main's per-project engine cache key: a project, salt and UTC month hash, cut
 * to 16 lowercase characters.
 */
export function s3CacheKeyFor({
  projectId,
  salt,
  now,
}: {
  projectId: string;
  salt: string;
  now: Instant;
}): string {
  const yearMonth = now.toString().slice(0, 7);

  return createHash("sha256")
    .update(`${projectId}-${salt}-${yearMonth}`)
    .digest("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 16)
    .toLowerCase();
}

/** The cache-key header to merge into an engine request, empty without a salt. */
export function s3CacheKeyHeaders({
  projectId,
  salt,
  now,
}: {
  projectId: string;
  salt: string | undefined;
  now: Instant;
}): Record<string, string> {
  if (!salt) return {};

  return { [S3_CACHE_KEY_HEADER]: s3CacheKeyFor({ projectId, salt, now }) };
}
