import type { Logger } from "@langwatch/observability";
import { captureException, toError } from "~/utils/posthogErrorCapture";

/**
 * Debounce window shared by all three Customer.io nurture subscribers.
 *
 * Single-sourced HERE rather than on one of the three, and that placement is
 * the point: the constant is a value, so importing it from a sibling
 * pipeline's subscriber module would make loading the evaluation or simulation
 * pipeline evaluate the trace subscriber and its entire import graph. This
 * module is a leaf — a number and two pure helpers — so nothing rides along.
 *
 * The value and the dedup keys are carried over verbatim from the reactors
 * (`CIO_REACTOR_DEBOUNCE_TTL_MS`) so nurture counts keep the same frequency
 * across the ADR-075 conversion.
 */
export const CIO_SYNC_DEBOUNCE_TTL_MS = 300_000;

/**
 * Sends one nurture call without waiting for it, and without letting it reject
 * into the subscriber's lane.
 *
 * Nurture data is lossy by contract (ADR-075 Class B): a dropped Customer.io
 * write is a slightly stale marketing trait, not a correctness problem, and
 * retrying an identify buys nothing. So the promise is deliberately not
 * awaited — the subscriber must not sit behind a third party's latency — and
 * its rejection is logged and reported rather than surfacing as an unhandled
 * rejection.
 *
 * @param what what the call was trying to do, phrased to complete
 *   "Failed to …" (e.g. `"identify user for first trace"`).
 */
export function nurtureFireAndForget({
  promise,
  logger,
  projectId,
  what,
}: {
  promise: Promise<unknown>;
  logger: Logger;
  projectId: string;
  what: string;
}): void {
  void promise.catch((error) => {
    logger.error({ projectId, error }, `Failed to ${what}`);
    captureException(toError(error));
  });
}

/**
 * How many of these the org had BEFORE the one being handled.
 *
 * The fold commits before the subscriber's job runs, so the run that triggered
 * this sync is already included in the org-wide count — subtract it to get the
 * prior count. Clamped at zero so a count that has not caught up cannot make
 * "is this the first one?" answer no.
 */
export function priorNurtureCount(rawCount: number): number {
  return Math.max(0, rawCount - 1);
}
