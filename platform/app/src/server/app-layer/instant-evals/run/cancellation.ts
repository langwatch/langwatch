/**
 * How a run is told to stop.
 *
 * A Redis key rather than a pub/sub message, and the difference matters: a
 * message reaches whoever is listening at the instant it is sent, and a run's
 * next page may be dispatched to a pod that was not. A key is a fact the page
 * about to start can read, so a cancellation arriving between pages is still
 * honoured by the page after it.
 *
 * The key is a hint, never the record. What actually stops a run is the
 * `cancel_requested` event and the process manager's own state; the key is the
 * fast path that keeps a page from starting work it is about to throw away, and
 * a deployment whose Redis is unreachable simply stops one page later.
 *
 * @see ../../../event-sourcing/pipelines/instant-eval-processing/process-manager/instantEval.process.ts
 */

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:instant-evals:cancellation");

/**
 * How long the key outlives the request.
 *
 * An hour, which outlives the longest run the caps allow: a hundred thousand
 * rows at the platform's own rate is under twenty minutes. Expiring at all is
 * what keeps a cancelled run's key from outliving the run itself.
 */
const INSTANT_EVAL_CANCEL_TTL_SECONDS = 60 * 60;

export function instantEvalCancelKey(runId: string): string {
  return `instant_eval:cancel:${runId}`;
}

/** The two Redis calls this needs, and nothing more. */
export interface InstantEvalCancellationRedis {
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<unknown>;
  exists(key: string): Promise<number>;
}

export interface InstantEvalCancellations {
  request(input: { runId: string }): Promise<void>;
  isRequested(input: { runId: string }): Promise<boolean>;
}

/**
 * The shipped implementation, which never throws.
 *
 * Both directions fail soft. A `request` that could not be written still has
 * the event behind it, and an `isRequested` that could not be read answers
 * false, which costs the run one more page rather than stopping a run no one
 * cancelled.
 */
export function createInstantEvalCancellations(
  redis: InstantEvalCancellationRedis | null,
): InstantEvalCancellations {
  return {
    async request({ runId }) {
      if (!redis) return;
      try {
        await redis.set(
          instantEvalCancelKey(runId),
          "1",
          "EX",
          INSTANT_EVAL_CANCEL_TTL_SECONDS,
        );
      } catch (error) {
        logger.warn(
          { runId, error },
          "Instant Eval cancellation hint could not be written; the run will stop on its recorded cancellation instead",
        );
      }
    },

    async isRequested({ runId }) {
      if (!redis) return false;
      try {
        return (await redis.exists(instantEvalCancelKey(runId))) > 0;
      } catch (error) {
        logger.warn(
          { runId, error },
          "Instant Eval cancellation hint could not be read; judging one more page",
        );
        return false;
      }
    },
  };
}
