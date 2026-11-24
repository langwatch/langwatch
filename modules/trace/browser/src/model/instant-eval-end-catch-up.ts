/**
 * When the page reads a run again that has nothing left to judge but still reads as judging: the
 * hint for its end can land before the run's row says so, and no later event hints again.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import type { ExplorerInstantEvalProgress } from "@langwatch/instant-eval-contract";
import { isExplorerInstantEvalRunActive } from "@langwatch/trace-contract";

const CATCH_UP_DELAYS_MS = [1_000, 2_000, 4_000] as const;
export const INSTANT_EVAL_CATCH_UP_EVERY_MS = 8_000;
export const INSTANT_EVAL_CATCH_UP_WINDOW_MS = 120_000;

/** A run that judged every row, or one the reader stopped, that has not said it ended. */
export function isAwaitingInstantEvalEnd({
  run,
  isStopRequested,
}: {
  run: Pick<ExplorerInstantEvalProgress, "status" | "progress" | "total">;
  isStopRequested: boolean;
}): boolean {
  if (!isExplorerInstantEvalRunActive(run.status)) return false;
  if (isStopRequested) return true;
  return run.total !== null && run.progress >= run.total;
}

/** How long after the last read the next one is due, or null once the window is spent. */
export function instantEvalCatchUpDelayMs({
  attempt,
  waitedMs,
}: {
  /** Reads already asked for while waiting, from zero. */
  attempt: number;
  /** How long the run has been waited on. */
  waitedMs: number;
}): number | null {
  if (waitedMs >= INSTANT_EVAL_CATCH_UP_WINDOW_MS) return null;
  return CATCH_UP_DELAYS_MS[attempt] ?? INSTANT_EVAL_CATCH_UP_EVERY_MS;
}
