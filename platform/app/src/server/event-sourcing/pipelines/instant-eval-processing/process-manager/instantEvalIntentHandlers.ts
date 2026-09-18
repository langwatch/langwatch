/**
 * The Instant Eval run's effects: plan it, judge a page, finish it.
 *
 * Everything impure lives here, behind one port the app layer implements, so
 * this pipeline imports no query service, no classifier and no repository. The
 * handlers' own job is the failure contract, and it is the same one the topic
 * clustering pages use because the same thing is true of both: the work costs
 * money and the outcome WRITE must never be retried through the outbox, since
 * that would redeliver the whole intent and pay for the page again.
 *
 *  - an attempt below the cap rethrows, so the outbox retries with backoff;
 *  - the final attempt records the run as failed and returns normally, so the
 *    message retires as dispatched rather than dead;
 *  - the outcome write is best-effort on both branches: losing it costs a
 *    stalled run the watchdog will finish, and rethrowing it would cost the
 *    page.
 *
 * @see ./instantEval.process.ts: the pure logic these serve
 * @see ../../../../../app-layer/instant-evals/run/instant-eval-run.executor.ts
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { InstantEvalOutcome } from "../schemas/constants";
import type {
  instantEvalFinishIntentSchema,
  instantEvalJudgePageIntentSchema,
  instantEvalPlanIntentSchema,
} from "./instantEvalProcess.types";

const logger = createLogger("langwatch:instant-eval-processing:intents");

/**
 * Attempts one intent gets before the run is failed.
 *
 * Three, matching the outbox cap declared on the pipeline. Two retries is
 * enough for a provider blip and few enough that a statement which cannot run
 * fails in under a minute rather than in ten.
 */
export const INSTANT_EVAL_MAX_ATTEMPTS = 3;

/**
 * How long a leased intent may hold its message.
 *
 * Ten minutes, which outlives the slowest healthy page by a wide margin: five
 * hundred texts at thirty-two in flight is seconds of judging plus two
 * queries. The lease has to outlive it or a second dispatcher re-leases
 * mid-flight and judges the same page concurrently.
 */
export const INSTANT_EVAL_OUTBOX_LEASE_MS = 10 * 60 * 1000;

/** Pages in flight per pod, and messages leased per drain. */
export const INSTANT_EVAL_OUTBOX_BATCH_SIZE = 4;

/** What the plan pass learned about a run before it spent anything. */
export interface InstantEvalPlan {
  readonly total: number;
  readonly pageSize: number;
  readonly isCapped: boolean;
  readonly keyColumns: readonly string[];
}

/** What one judged page added to the run. */
export interface InstantEvalPageOutcome {
  readonly rows: number;
  readonly matched: number;
  readonly matchedByQuestion: Readonly<Record<string, number>>;
  readonly failed: number;
  readonly skipped: number;
  readonly inputTokens: number;
  readonly requests: number;
  /** The last trace id of the page, or null when it judged nothing. */
  readonly cursor: string | null;
  readonly hasNextPage: boolean;
}

/** What finishing a run cost. */
export interface InstantEvalSpend {
  readonly costUsd: number;
  readonly priceUsd: number;
}

/** The domain work this pipeline drives, implemented by the app layer. */
export interface InstantEvalRunPort {
  plan(input: { runId: string; projectId: string }): Promise<InstantEvalPlan>;
  judgePage(input: {
    runId: string;
    projectId: string;
    page: number;
    afterTraceId: string | null;
    pageSize: number;
    remaining: number;
    keyColumns: readonly string[];
  }): Promise<InstantEvalPageOutcome>;
  /** Records the run's spend and returns what it came to. */
  finish(input: {
    runId: string;
    projectId: string;
    outcome: InstantEvalOutcome;
    inputTokens: number;
    requests: number;
  }): Promise<InstantEvalSpend>;
}

/** This same pipeline's write surface, resolved after `.build()`. */
export interface InstantEvalOutcomeCommands {
  recordPlanned(args: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    total: number;
    pageSize: number;
    isCapped: boolean;
    keyColumns: string[];
  }): Promise<unknown>;
  recordPageJudged(args: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    page: number;
    rows: number;
    matched: number;
    matchedByQuestion: Record<string, number>;
    failed: number;
    skipped: number;
    inputTokens: number;
    requests: number;
    cursor: string | null;
    hasNextPage: boolean;
  }): Promise<unknown>;
  recordFinished(args: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    outcome: InstantEvalOutcome;
    errorCode: string | null;
    inputTokens: number;
    requests: number;
    costUsd: number;
    priceUsd: number;
  }): Promise<unknown>;
}

export interface InstantEvalDispatchDeps {
  runPort: InstantEvalRunPort;
  /**
   * Late-bound on purpose: the executors are declared while the pipeline is
   * being built, and these are the SAME pipeline's commands, which exist only
   * after `.build()`.
   */
  commands: () => InstantEvalOutcomeCommands;
  maxAttempts?: number;
  clock?: () => number;
}

type PlanPayload = z.infer<typeof instantEvalPlanIntentSchema>;
type JudgePagePayload = z.infer<typeof instantEvalJudgePageIntentSchema>;
type FinishPayload = z.infer<typeof instantEvalFinishIntentSchema>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The code a failed run carries.
 *
 * A handled error's own code, because it names something the caller can act on
 * and the client registry already has words for it. Anything else is
 * `internal_error`, which is the honest answer: a driver diagnostic is not
 * something a caller can act on and must not be relayed as if it were.
 */
function failureCode(error: unknown): string {
  return error instanceof HandledError ? error.code : "internal_error";
}

/** Records a run as failed, best-effort. */
async function recordFailure({
  deps,
  payload,
  code,
  context,
}: {
  deps: InstantEvalDispatchDeps;
  payload: { runId: string; projectId: string };
  code: string;
  context: Record<string, unknown>;
}): Promise<void> {
  const now = deps.clock?.() ?? Date.now();
  try {
    await deps.commands().recordFinished({
      tenantId: payload.projectId,
      occurredAt: now,
      runId: payload.runId,
      outcome: "failed",
      errorCode: code,
      inputTokens: 0,
      requests: 0,
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
async function handleIntentFailure({
  deps,
  payload,
  error,
  intentContext,
  context,
}: {
  deps: InstantEvalDispatchDeps;
  payload: { runId: string; projectId: string };
  error: unknown;
  intentContext: IntentContext;
  context: Record<string, unknown>;
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
  });
}

export function createInstantEvalPlanHandler(deps: InstantEvalDispatchDeps) {
  return async (
    payload: PlanPayload,
    intentContext: IntentContext,
  ): Promise<void> => {
    const context = { runId: payload.runId, projectId: payload.projectId };
    let plan: InstantEvalPlan;
    try {
      plan = await deps.runPort.plan(payload);
    } catch (error) {
      await handleIntentFailure({
        deps,
        payload,
        error,
        intentContext,
        context,
      });
      return;
    }

    try {
      await deps.commands().recordPlanned({
        tenantId: payload.projectId,
        occurredAt: deps.clock?.() ?? Date.now(),
        runId: payload.runId,
        total: plan.total,
        pageSize: plan.pageSize,
        isCapped: plan.isCapped,
        keyColumns: [...plan.keyColumns],
      });
    } catch (error) {
      // The plan itself succeeded and cost nothing; losing the record leaves a
      // run the watchdog finishes, which is cheaper than replanning.
      logger.error(
        { ...context, error: errorText(error) },
        "Instant Eval plan could not be recorded",
      );
    }
  };
}

export function createInstantEvalJudgePageHandler(
  deps: InstantEvalDispatchDeps,
) {
  return async (
    payload: JudgePagePayload,
    intentContext: IntentContext,
  ): Promise<void> => {
    const context = {
      runId: payload.runId,
      projectId: payload.projectId,
      page: payload.page,
    };
    let outcome: InstantEvalPageOutcome;
    try {
      outcome = await deps.runPort.judgePage({
        ...payload,
        keyColumns: payload.keyColumns,
      });
    } catch (error) {
      await handleIntentFailure({
        deps,
        payload,
        error,
        intentContext,
        context,
      });
      return;
    }

    try {
      await deps.commands().recordPageJudged({
        tenantId: payload.projectId,
        occurredAt: deps.clock?.() ?? Date.now(),
        runId: payload.runId,
        page: payload.page,
        rows: outcome.rows,
        matched: outcome.matched,
        matchedByQuestion: { ...outcome.matchedByQuestion },
        failed: outcome.failed,
        skipped: outcome.skipped,
        inputTokens: outcome.inputTokens,
        requests: outcome.requests,
        cursor: outcome.cursor,
        hasNextPage: outcome.hasNextPage,
      });
    } catch (error) {
      // The page was judged and its judgements are already written. Retrying
      // the intent would judge and bill it again, so the record is lost and
      // the watchdog finishes the run.
      logger.error(
        { ...context, error: errorText(error) },
        "Instant Eval judged page could not be recorded",
      );
    }
  };
}

export function createInstantEvalFinishHandler(deps: InstantEvalDispatchDeps) {
  return async (
    payload: FinishPayload,
    intentContext: IntentContext,
  ): Promise<void> => {
    const context = {
      runId: payload.runId,
      projectId: payload.projectId,
      outcome: payload.outcome,
    };
    let spend: InstantEvalSpend;
    try {
      spend = await deps.runPort.finish({
        runId: payload.runId,
        projectId: payload.projectId,
        outcome: payload.outcome,
        inputTokens: payload.inputTokens,
        requests: payload.requests,
      });
    } catch (error) {
      await handleIntentFailure({
        deps,
        payload,
        error,
        intentContext,
        context,
      });
      return;
    }

    try {
      await deps.commands().recordFinished({
        tenantId: payload.projectId,
        occurredAt: deps.clock?.() ?? Date.now(),
        runId: payload.runId,
        outcome: payload.outcome,
        errorCode: payload.errorCode,
        inputTokens: payload.inputTokens,
        requests: payload.requests,
        costUsd: spend.costUsd,
        priceUsd: spend.priceUsd,
      });
    } catch (error) {
      logger.error(
        { ...context, error: errorText(error) },
        "Instant Eval run outcome could not be recorded",
      );
    }
  };
}
