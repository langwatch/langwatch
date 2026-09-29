/**
 * Stopping a page that is already judging.
 *
 * Cancellation between pages is the process manager's: it simply does not
 * dispatch the next one. This is the other half, for the page already in
 * flight. A five-hundred-row page is tens of seconds of judging and a real
 * amount of spend, so a cancel that arrives after the page started should stop
 * it rather than wait for it.
 *
 * The signal it produces goes to the hydration stage, which abandons the
 * classifications it has not begun. The rows already judged are still written
 * and still billed, which is the right outcome: they were paid for.
 *
 * @see ./instant-eval-run.judge-page.ts
 * @see ./cancellation.ts: where the request is recorded
 */

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:instant-evals:cancel-watch");

/**
 * How often a page in flight re-reads the cancellation.
 *
 * One second: a Stop pressed in the Explorer is answered by the run within
 * about a second plus the classifications already in flight, and it is one
 * Redis read per interval rather than one per classification.
 */
export const INSTANT_EVAL_CANCEL_POLL_MS = 1_000;

/** An abort signal that fires when the run is cancelled, or null when it cannot be. */
export function watchForCancellation({
  isCancelled,
  projectId,
  runId,
}: {
  /** Whether the run has been asked to stop, or absent when it cannot be. */
  isCancelled?: (input: {
    projectId: string;
    runId: string;
  }) => Promise<boolean>;
  projectId: string;
  runId: string;
}): { signal: AbortSignal; stop: () => void } | null {
  if (!isCancelled) return null;

  const controller = new AbortController();
  const timer = setInterval(() => {
    void isCancelled({ projectId, runId })
      .then((cancelled) => {
        if (cancelled) controller.abort();
      })
      .catch((error: unknown) => {
        // A cancellation read that fails leaves the page running, which is the
        // safe direction: the between-pages check and the grace wake both
        // still stop the run.
        logger.warn(
          { projectId, runId, error },
          "Instant Eval cancellation check failed mid-page",
        );
      });
  }, INSTANT_EVAL_CANCEL_POLL_MS);
  timer.unref?.();

  return { signal: controller.signal, stop: () => clearInterval(timer) };
}
