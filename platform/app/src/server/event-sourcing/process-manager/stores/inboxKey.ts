import { createHash } from "node:crypto";

/**
 * Derive the inbox's unique key for a source event id.
 *
 * `sourceEventId` is `idempotencyKey ?? id`, and an idempotency key is
 * composed by whichever pipeline emits the command — so its length is the
 * emitting domain's business, not the store's. Postgres refuses a btree index
 * row past ~2704 bytes, and the inbox's unique constraint spans
 * (processName, projectId, <source event>), so indexing the raw value made the
 * store's correctness depend on every caller staying short. One that did not
 * (a model provider's round-trip blob stapled onto a tool call id) turned the
 * insert into a hard 54000 inside the commit transaction — deterministic, so
 * the retry ladder ran out and parked the aggregate's group for good.
 *
 * Hashing unconditionally rather than only when long keeps one code path with
 * no threshold to get wrong, and makes the constraint the same width whatever
 * any future pipeline concatenates. The raw id stays on the row, unindexed,
 * so operators can still read what was consumed.
 */
export function deriveInboxKey(sourceEventId: string): string {
  return createHash("sha256").update(sourceEventId, "utf8").digest("hex");
}
