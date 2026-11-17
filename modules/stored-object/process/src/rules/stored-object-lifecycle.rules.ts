import type { Instant } from "@langwatch/time";

import type { StoredObjectRecord } from "../repositories/stored-object-record.repository.ts";

/** The row's next state: every lifecycle move bumps the generation the conditional write checks. */
export function movedOn({
  value,
  now,
  changes,
}: {
  value: StoredObjectRecord;
  now: Instant;
  changes: Partial<StoredObjectRecord>;
}): StoredObjectRecord {
  return { ...value, ...changes, generation: value.generation + 1, updatedAt: now };
}
