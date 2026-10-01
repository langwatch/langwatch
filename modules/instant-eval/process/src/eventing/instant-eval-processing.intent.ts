/**
 * The run's effects: plan it, judge a page, finish it. The work costs money, so
 * an attempt below the cap rethrows and the final one fails the run instead.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { IntentContext, IntentExecutor } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import type { InstantEvalOutcome } from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type {
  InstantEvalFinishIntent,
  InstantEvalJudgePageIntent,
  InstantEvalPlanIntent,
} from "./instant-eval-processing-data.process.ts";

const logger = createLogger("langwatch:instant-eval:intents");

/**
 * Attempts one intent gets before the run is failed. Three, matching the
 * outbox cap declared on the pipeline: enough for a provider blip, few enough
 * that a statement which cannot run fails in under a minute.
 */
export const INSTANT_EVAL_MAX_ATTEMPTS = 3;

/**
 * How long a leased intent may hold its message. Ten minutes, which outlives
 * the slowest healthy page by a wide margin — the lease has to, or a second
 * dispatcher re-leases mid-flight and judges the same page concurrently.
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
  /** Boolean matches, or null when the run asked no boolean question. */
  readonly matched: number | null;
  readonly matchedByQuestion: Readonly<Record<string, number>>;
  readonly failed: number;
  readonly skipped: number;
  readonly inputTokens: number;
  readonly requests: number;
  /** The last trace id of the page, or null when it judged nothing. */
  readonly cursor: string | null;
  /** The last span id of the page, for a statement keyed by the pair. */
  readonly cursorSpanId: string | null;
  readonly hasNextPage: boolean;
}

/** What finishing a run cost. */
export interface InstantEvalSpend {
  readonly costUsd: number;
  readonly priceUsd: number;
}

/** The domain work this pipeline drives, carried out by the module's services. */
export interface InstantEvalRunExecutor {
  plan(input: { runId: string; projectId: string }): Promise<InstantEvalPlan>;
  judgePage(input: {
    runId: string;
    projectId: string;
    page: number;
    afterTraceId: string | null;
    afterSpanId: string | null;
    pageSize: number;
    remaining: number;
    keyColumns: readonly string[];
    /**
     * The instant the delivery's outbox lease lapses, or null where nothing
     * leased it. A page still judging past it would be judged a second time by
     * whoever leases the message next, so the executor stops before it.
     */
    deadlineAt: number | null;
  }): Promise<InstantEvalPageOutcome>;
  /** Records the run's spend and answers what it came to. */
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
    matched: number | null;
    matchedByQuestion: Record<string, number>;
    failed: number;
    skipped: number;
    inputTokens: number;
    requests: number;
    cursor: string | null;
    cursorSpanId: string | null;
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
  executor: InstantEvalRunExecutor;
  /**
   * Late-bound on purpose: the executors are declared while the pipeline is
   * being built, and these are the SAME pipeline's commands, which exist only
   * after `.build()`.
   */
  commands: () => InstantEvalOutcomeCommands;
  maxAttempts?: number;
  clock?: () => number;
}

/** Whatever of an error is safe to log. */
export function instantEvalErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The code a failed run carries: a handled error's own, because it names
 * something a caller can act on. Anything else is `internal_error`.
 */
export function instantEvalFailureCode(error: unknown): string {
  return error instanceof HandledError ? error.code : "internal_error";
}

/**
 * Records a run as failed, best-effort. The spend carries through: a run that
 * judged eighty pages and lost the eighty-first still spent what those pages
 * spent, and zeroing the counters here would file that spend nowhere.
 */
export async function recordInstantEvalFailure({
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
  try {
    await deps.commands().recordFinished({
      tenantId: payload.projectId,
      occurredAt: deps.clock?.() ?? nowInstant().epochMilliseconds,
      runId: payload.runId,
      outcome: "failed",
      errorCode: code,
      inputTokens: spend?.inputTokens ?? 0,
      requests: spend?.requests ?? 0,
      costUsd: 0,
      priceUsd: 0,
    });
  } catch (error) {
    // Rethrowing would hand the message back to the outbox, which redelivers
    // the whole intent. The stall wake recovers a run whose failure was lost.
    logger.error(
      { ...context, error: instantEvalErrorText(error) },
      "Instant Eval run failure could not be recorded",
    );
  }
}

/**
 * The shared failure branch: retry while attempts remain, otherwise fail the
 * run and retire the message.
 */
export async function handleInstantEvalIntentFailure({
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
  spend?: { inputTokens: number; requests: number };
}): Promise<void> {
  const maxAttempts = deps.maxAttempts ?? INSTANT_EVAL_MAX_ATTEMPTS;
  if (intentContext.attempt < maxAttempts) {
    logger.warn(
      { ...context, attempt: intentContext.attempt, error: instantEvalErrorText(error) },
      "Instant Eval step failed; the outbox will retry",
    );
    throw error;
  }
  logger.error(
    { ...context, error: instantEvalErrorText(error) },
    "Instant Eval step failed on its final attempt; failing the run",
  );
  await recordInstantEvalFailure({
    deps,
    payload,
    code: instantEvalFailureCode(error),
    context,
    ...(spend ? { spend } : {}),
  });
}

export function createInstantEvalPlanHandler(
  deps: InstantEvalDispatchDeps,
): IntentExecutor<InstantEvalPlanIntent> {
  return async (payload, intentContext) => {
    const context = { runId: payload.runId, projectId: payload.projectId };
    let plan: InstantEvalPlan;
    try {
      plan = await deps.executor.plan(payload);
    } catch (error) {
      await handleInstantEvalIntentFailure({ deps, payload, error, intentContext, context });

      return;
    }

    try {
      await deps.commands().recordPlanned({
        tenantId: payload.projectId,
        occurredAt: deps.clock?.() ?? nowInstant().epochMilliseconds,
        runId: payload.runId,
        total: plan.total,
        pageSize: plan.pageSize,
        isCapped: plan.isCapped,
        keyColumns: [...plan.keyColumns],
      });
    } catch (error) {
      // The plan succeeded and cost nothing; losing the record leaves a run the
      // stall wake finishes, which is cheaper than replanning.
      logger.error(
        { ...context, error: instantEvalErrorText(error) },
        "Instant Eval plan could not be recorded",
      );
    }
  };
}

export function createInstantEvalJudgePageHandler(
  deps: InstantEvalDispatchDeps,
): IntentExecutor<InstantEvalJudgePageIntent> {
  return async (payload, intentContext) => {
    const context = {
      runId: payload.runId,
      projectId: payload.projectId,
      page: payload.page,
    };
    let outcome: InstantEvalPageOutcome;
    try {
      outcome = await deps.executor.judgePage({
        ...payload,
        keyColumns: payload.keyColumns,
        // The page stops before its lease lapses, so no paid judgment runs twice.
        deadlineAt: intentContext.leaseExpiresAt ?? null,
      });
    } catch (error) {
      await handleInstantEvalIntentFailure({ deps, payload, error, intentContext, context });

      return;
    }

    try {
      await deps.commands().recordPageJudged({
        tenantId: payload.projectId,
        occurredAt: deps.clock?.() ?? nowInstant().epochMilliseconds,
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
        cursorSpanId: outcome.cursorSpanId,
        hasNextPage: outcome.hasNextPage,
      });
    } catch (error) {
      // The page was judged and its judgements are already written. Retrying
      // would judge and bill it again, so the record is lost and the stall wake
      // finishes the run.
      logger.error(
        { ...context, error: instantEvalErrorText(error) },
        "Instant Eval judged page could not be recorded",
      );
    }
  };
}

export function createInstantEvalFinishHandler(
  deps: InstantEvalDispatchDeps,
): IntentExecutor<InstantEvalFinishIntent> {
  return async (payload, intentContext) => {
    const context = {
      runId: payload.runId,
      projectId: payload.projectId,
      outcome: payload.outcome,
    };
    let spend: InstantEvalSpend;
    try {
      spend = await deps.executor.finish({
        runId: payload.runId,
        projectId: payload.projectId,
        outcome: payload.outcome,
        inputTokens: payload.inputTokens,
        requests: payload.requests,
      });
    } catch (error) {
      // The payload already carries what every judged page spent, so a finish
      // that cannot write its cost row still reports the run's tokens.
      await handleInstantEvalIntentFailure({
        deps,
        payload,
        error,
        intentContext,
        context,
        spend: { inputTokens: payload.inputTokens, requests: payload.requests },
      });

      return;
    }

    try {
      await deps.commands().recordFinished({
        tenantId: payload.projectId,
        occurredAt: deps.clock?.() ?? nowInstant().epochMilliseconds,
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
        { ...context, error: instantEvalErrorText(error) },
        "Instant Eval run outcome could not be recorded",
      );
    }
  };
}
