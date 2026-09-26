/**
 * What happens when one of a run's steps fails.
 *
 * Two decisions, and both are about who gets told. A step with attempts left
 * rethrows, which hands the message back to the outbox. A step on its last
 * attempt records the run as failed, carrying the spend the run had already
 * accumulated so the tokens are filed against the run rather than nowhere.
 *
 * @see ./instantEvalIntentHandlers.ts: the steps these serve
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  INSTANT_EVAL_MAX_ATTEMPTS,
  type InstantEvalDispatchDeps,
} from "./instantEvalIntentHandlers";

const logger = createLogger("langwatch:instant-evals:intent-failures");

/** Whatever of an error is safe to log. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The code a failed run carries.
 *
 * A handled error's own code, because it names something the caller can act on
 * and the client registry already has words for it. Anything else is
 * `internal_error`, which is all we can say: a driver diagnostic is not
 * something a caller can act on and must not be relayed as if it were.
 */
export function failureCode(error: unknown): string {
  return error instanceof HandledError ? error.code : "internal_error";
}

/**
 * Records a run as failed, best-effort.
 *
 * The spend carries through. A run that judged eighty pages and then lost the
 * eighty-first still spent what those pages spent, and zeroing the counters
 * here would file that spend nowhere: the tokens are already on the classifier
 * bill whether the run reached its end or not. The finish intent's payload
 * already holds the totals the process summed from every judged page, so a
 * failure of THAT intent reports them; a plan or page intent has none yet and
 * reports zero, which is the truth for a run that never judged a page.
 */
export async function recordFailure({
  deps,
  payload,
  code,
  context,
  spend,
}: {
  deps: InstantEvalDispatchDeps;
  payload: { runId: string; projectId: string };
  code: string;
  context: Record<string, unknown>;
  /** What the run had spent by the time it failed, when the intent knows. */
  spend?: { inputTokens: number; requests: number };
}): Promise<void> {
  const now = deps.clock?.() ?? Date.now();
  try {
    await deps.commands().recordFinished({
      tenantId: payload.projectId,
      occurredAt: now,
      runId: payload.runId,
      outcome: "failed",
      errorCode: code,
      inputTokens: spend?.inputTokens ?? 0,
      requests: spend?.requests ?? 0,
      costUsd: 0,
      priceUsd: 0,
    });
  } catch (error) {
    // Rethrowing here would hand the message back to the outbox, which
    // redelivers the whole intent. The stall watchdog is what recovers a run
    // whose failure was never recorded.
    logger.error(
      { ...context, error: errorText(error) },
      "Instant Eval run failure could not be recorded",
    );
  }
}

/**
 * The shared failure branch: retry while attempts remain, otherwise fail the
 * run and retire the message.
 */
export async function handleIntentFailure({
  deps,
  payload,
  error,
  intentContext,
  context,
  spend,
}: {
  deps: InstantEvalDispatchDeps;
  payload: { runId: string; projectId: string };
  error: unknown;
  intentContext: IntentContext;
  context: Record<string, unknown>;
  /** What the run had spent by the time it failed, when the intent knows. */
  spend?: { inputTokens: number; requests: number };
}): Promise<void> {
  const maxAttempts = deps.maxAttempts ?? INSTANT_EVAL_MAX_ATTEMPTS;
  if (intentContext.attempt < maxAttempts) {
    logger.warn(
      { ...context, attempt: intentContext.attempt, error: errorText(error) },
      "Instant Eval step failed; the outbox will retry",
    );
    throw error;
  }
  logger.error(
    { ...context, error: errorText(error) },
    "Instant Eval step failed on its final attempt; failing the run",
  );
  await recordFailure({
    deps,
    payload,
    code: failureCode(error),
    context,
    ...(spend ? { spend } : {}),
  });
}
