import { JOB_RETRY_CONFIG } from "../shared";

/**
 * The retry count off a staged job id left over from before the staged-job-id
 * reuse migration described in the (now-retired) ADR-080 — current model is
 * ADR-100 — when the ladder appended `/r/<n>` to the id and read the count
 * back by counting the segments.
 *
 * READ-ONLY, and only as a last resort. A job part-way up the unreadable-body
 * ladder at deploy time recorded its count nowhere else — that path re-staged
 * the value unmodified and never wrote the group's chain — so without this it
 * would come back with a fresh budget and a fail-safe would reset mid-flight.
 * Nothing writes this shape any more: a legacy id is a value to interpret on
 * the way out, not a format to keep alive.
 *
 * DELETE THIS MODULE once no job staged before the ADR-080 (now ADR-100)
 * deploy can still be in backoff — an hour is comfortably past
 * GROUP_ATTEMPT_TTL_SECONDS. It lives
 * alone so that removal is an `rm` rather than a diff against the queue's
 * hottest file.
 */
export function legacyStagedJobAttempt(stagedJobId: string): number {
  // Anchored to the TRAILING ladder. The legacy markers were always appended,
  // so nothing before the tail is one — and an unanchored scan would let a
  // producer's own event id (which is free-form and forms the base of the
  // staged id) donate a `/r/<n>` segment and set another job's retry budget.
  const tail = /((?:\/[rp]\/[^/]+)+)$/.exec(stagedJobId)?.[1] ?? "";
  let highest = 0;
  for (const [, digits] of tail.matchAll(/\/r\/(\d+)(?=\/|$)/g)) {
    const value = Number(digits);
    // The terminal restage stamped a wall clock under this same marker. Reading
    // one as an attempt would vault past the budget and discard a job that
    // still had rungs left, so anything outside the ladder's range is not a
    // count.
    if (
      Number.isInteger(value) &&
      value > highest &&
      value <= JOB_RETRY_CONFIG.maxAttempts
    ) {
      highest = value;
    }
  }
  return highest;
}
