import type { ObjectDigest } from "@langwatch/process-stores/members";
import { StoredObjectIntegrityConflictError } from "@langwatch/stored-object-contract";
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

/** The bytes a stored row says it holds must be the bytes that landed. */
export function assertByteFacts(value: StoredObjectRecord, byteLength: number): void {
  if (value.byteLength !== byteLength) {
    throw new StoredObjectIntegrityConflictError({
      projectId: value.tenantId,
      objectId: value.id,
      expectedByteLength: value.byteLength,
      actualByteLength: byteLength,
    });
  }
}

/** A pending row the signed route already wrote holds the digest that write took. */
export function isLanded(value: StoredObjectRecord): boolean {
  return value.sha256 !== "";
}

export function landedDigestOf(value: StoredObjectRecord): ObjectDigest {
  return { sha256: value.sha256, byteLength: value.byteLength };
}
