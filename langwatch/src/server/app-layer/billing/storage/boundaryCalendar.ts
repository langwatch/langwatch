import { INDEFINITE_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";

/**
 * Included window (ADR-039, kept from ADR-027): rows are billable once older
 * than 35 days AND still under retention. 35 is a clean week-partition
 * boundary of the retention system.
 */
export const BILLABLE_AFTER_DAYS = 35;

/** Day-slices per week partition. */
export const PARTITION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One day-slice of a week partition crossing the billable window:
 * its bytes become billable at `entryAt` and stop being billable at `exitAt`.
 */
export interface BoundaryCrossing {
  /** UTC midnight of the ingest day this crossing covers. */
  sliceDate: Date;
  /** The instant the slice ages past the billable line (sliceDate + 35d). */
  entryAt: Date;
  /**
   * The instant retention entitlement ends (sliceDate + retentionDays);
   * null for indefinite retention (0 = keep forever) — billable, never exits.
   */
  exitAt: Date | null;
}

/**
 * The deterministic boundary calendar (ADR-039 Decision 3): given a week
 * partition and the retention of its rows, exactly when each day-slice enters
 * and leaves the billable window. Pure — retention is deterministic, so every
 * crossing is knowable in advance; this function is the single source of that
 * schedule for the transit emitter, the exit mirror, and seeding.
 *
 * Retention ≤ 35 days returns no crossings: below 35 the rows die before ever
 * becoming billable (free tier); at exactly 35 entry and exit coincide, so
 * the partition nets to zero and both edges are skipped — €0-by-construction
 * with zero queries.
 */
export function computeBoundaryCalendar({
  partitionStart,
  retentionDays,
}: {
  /** UTC midnight of the partition's first day. */
  partitionStart: Date;
  retentionDays: number;
}): BoundaryCrossing[] {
  const indefinite = retentionDays === INDEFINITE_RETENTION_DAYS;
  if (!indefinite && retentionDays <= BILLABLE_AFTER_DAYS) return [];

  return Array.from({ length: PARTITION_DAYS }, (_, day) => {
    const sliceMs = partitionStart.getTime() + day * DAY_MS;
    return {
      sliceDate: new Date(sliceMs),
      entryAt: new Date(sliceMs + BILLABLE_AFTER_DAYS * DAY_MS),
      exitAt: indefinite ? null : new Date(sliceMs + retentionDays * DAY_MS),
    };
  });
}
