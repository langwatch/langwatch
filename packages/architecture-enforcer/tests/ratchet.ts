import { readFileSync } from "node:fs";

import { z } from "zod";

/**
 * A ruled transition's shrink-only list: each key's count may fall, never
 * rise, and a fall is written back in the same change. See
 * dev/docs/ARCHITECTURE.md §17; no policy reads one.
 */
const ratchetFile = z.object({
  record: z.string().min(1),
  findings: z.record(z.string(), z.number().int().positive()),
});

export type RatchetFile = z.infer<typeof ratchetFile>;

export function readRatchet({ file }: { file: string }): RatchetFile {
  return ratchetFile.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** How many findings each key holds today. */
export function countByKey(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);

  return counts;
}

/** `grown`: above the list, so refused. `stale`: below it, so the list must shrink. */
export function compareRatchet({
  current,
  listed,
}: {
  current: ReadonlyMap<string, number>;
  listed: Readonly<Record<string, number>>;
}): { grown: string[]; stale: string[] } {
  const grown = [...current]
    .filter(([key, count]) => count > (listed[key] ?? 0))
    .map(([key, count]) => `${key}: ${count} found, ${listed[key] ?? 0} listed`);
  const stale = Object.entries(listed)
    .filter(([key, count]) => (current.get(key) ?? 0) < count)
    .map(([key, count]) => `${key}: ${current.get(key) ?? 0} found, ${count} listed`);

  return { grown: grown.toSorted(), stale: stale.toSorted() };
}
