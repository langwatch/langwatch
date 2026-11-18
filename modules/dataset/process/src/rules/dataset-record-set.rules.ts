import { createHash } from "node:crypto";

import type { Instant } from "@langwatch/time";

/**
 * One value for a dataset's records and when each last changed: any add, delete or in-place edit
 * changes it, even one whose time is not the newest (a writer's clock behind another record's).
 */
export function recordSetDigest(records: readonly { id: string; updatedAt: Instant }[]): string {
  const hash = createHash("sha256");
  const lines = records.map((record) => `${record.id}:${record.updatedAt.epochMilliseconds}`);
  for (const line of lines.toSorted()) hash.update(`${line}\n`);
  return hash.digest("hex");
}
