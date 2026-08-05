/**
 * The one tally of run outcomes, and the pass rate derived from it.
 *
 * Lives in `shared/` because both sides count the same runs: the run history
 * panel renders the numbers, the report and the export compute them. Both
 * import the functions as values rather than types, so a home under `server/`
 * would drag that module's graph into the browser bundle.
 *
 * @see specs/suites/pass-rate-single-source.feature
 */

import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { categorizeRunStatus } from "~/server/scenarios/scenario-run-category";

/**
 * How many runs landed in each outcome bucket, plus the two derived totals
 * that callers quote on screen.
 */
export interface RunOutcomeCounts {
  passedCount: number;
  failedCount: number;
  stalledCount: number;
  cancelledCount: number;
  inProgressCount: number;
  queuedCount: number;
  /** Runs that reached a verdict: passed + failed. */
  completedCount: number;
  /** Runs that reached any terminal state, verdict or not. The pass-rate denominator. */
  settledCount: number;
  totalCount: number;
}

/**
 * Tallies run statuses into outcome buckets.
 *
 * Pure, and imports nothing beyond the status enum and its categoriser, so the
 * run history panel and server-side readers can share it rather than each
 * keeping a copy of the switch.
 *
 * @see specs/suites/pass-rate-single-source.feature
 */
export function countRunOutcomes({
  statuses,
}: {
  statuses: Iterable<ScenarioRunStatus>;
}): RunOutcomeCounts {
  let passedCount = 0;
  let failedCount = 0;
  let stalledCount = 0;
  let cancelledCount = 0;
  let inProgressCount = 0;
  let queuedCount = 0;
  let totalCount = 0;

  for (const status of statuses) {
    totalCount++;
    switch (categorizeRunStatus(status)) {
      case "success":
        passedCount++;
        break;
      case "failure":
        failedCount++;
        break;
      case "stalled":
        stalledCount++;
        break;
      case "cancelled":
        cancelledCount++;
        break;
      case "in_progress":
        inProgressCount++;
        break;
      case "queued":
        queuedCount++;
        break;
    }
  }

  return {
    passedCount,
    failedCount,
    stalledCount,
    cancelledCount,
    inProgressCount,
    queuedCount,
    completedCount: passedCount + failedCount,
    settledCount: passedCount + failedCount + stalledCount + cancelledCount,
    totalCount,
  };
}

/**
 * Pass rate as a percentage, or null when it cannot be answered yet.
 *
 * Stalled and cancelled runs are in the denominator: they did not pass, and
 * leaving them out would quietly round the rate up. Runs still in progress or
 * queued are excluded, because their outcome is genuinely unknown.
 *
 * Null rather than zero when nothing has settled — zero reads as "everything
 * failed", which is a different claim from "we do not know yet". An empty
 * collection is zero, since there is nothing pending to learn about.
 */
export function passRateFrom({
  counts,
}: {
  counts: RunOutcomeCounts;
}): number | null {
  if (counts.settledCount > 0) {
    return (counts.passedCount / counts.settledCount) * 100;
  }
  return counts.totalCount > 0 ? null : 0;
}
