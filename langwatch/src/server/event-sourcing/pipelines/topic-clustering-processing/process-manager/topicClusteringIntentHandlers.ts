import { createLogger } from "@langwatch/observability";

import {
  incrementTopicClusteringPageTotal,
  observeTopicClusteringPageDuration,
} from "~/server/metrics";

import type {
  IntentContext,
  IntentExecutor,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { ClusteringPageOutcome } from "~/server/app-layer/topic-clustering/clustering";
import { classifyClusteringError } from "~/server/app-layer/topic-clustering/clustering-error";

import type { TopicClusteringRunIntent } from "./topicClusteringProcess.types";

const logger = createLogger("langwatch:topic-clustering:process-effects");

/**
 * Delivery attempts before the run is recorded as failed — parity with the
 * BullMQ worker this replaces (3 attempts, exponential backoff).
 */
export const TOPIC_CLUSTERING_MAX_ATTEMPTS = 3;

/**
 * The lease must OUTLIVE the slowest healthy clustering page, or a second
 * dispatcher re-leases the row mid-flight and re-runs the same page
 * concurrently. A page is up to 2000 traces through langevals batch
 * clustering (embeddings + LLM naming) — minutes, not seconds — so the
 * generic 30s default is unsafe here.
 */
export const TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS = 20 * 60 * 1000;

/**
 * Leased per drain AND dispatched concurrently (the pipeline declares both):
 * this constant is the effective clustering concurrency ADR-051 §4 promises,
 * matching the old worker's cap of 3. Bounding the lease batch to the same
 * number keeps leased-but-waiting messages from sitting invisible behind a
 * slow page for the whole lease.
 */
export const TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE = 3;

/** The domain function one clustering intent executes. */
export interface TopicClusteringRunPort {
  runClusteringPage(params: {
    projectId: string;
    searchAfter: [number, string] | null;
    /** Logical run identity; keys the recordTopics dedupe per page. */
    runId: string;
    page: number;
  }): Promise<ClusteringPageOutcome>;
}

/** The pipeline commands the effect reports its outcome through. */
export interface TopicClusteringOutcomeCommands {
  recordClusteringRunStarted(params: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    page: number;
  }): Promise<void>;
  recordClusteringRunCompleted(params: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    page: number;
    mode: ClusteringPageOutcome["mode"];
    tracesProcessed: number;
    topicsCount: number;
    subtopicsCount: number;
    skippedReason?: ClusteringPageOutcome["skippedReason"];
    nextSearchAfter?: [number, string];
  }): Promise<void>;
  recordClusteringRunFailed(params: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    page: number;
    error: string;
    errorCode: string;
    isUserActionable: boolean;
  }): Promise<void>;
}

export interface TopicClusteringDispatchDeps {
  runPort: TopicClusteringRunPort;
  /**
   * Late-bound on purpose: the executor is declared while the pipeline is
   * being built, and these are the SAME pipeline's commands — they only
   * exist after `.build()`. The registry supplies a getter it resolves
   * post-build; dispatch happens long after that.
   */
  commands: () => TopicClusteringOutcomeCommands;
  maxAttempts?: number;
  clock?: () => number;
}

/** Everything a page's bookkeeping needs to identify itself in logs/events. */
interface PageContext {
  projectId: string;
  runId: string;
  page: number;
  attempt: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Announce the page before working it, so "a run is in progress" is a
 * recorded fact rather than something the settings page has to infer.
 * A scheduled run emits nothing at its start (the wake is internal to
 * the process) and a single-page run never had an in-flight moment in
 * the log at all, so the badge was unreachable for both.
 *
 * Best-effort by design: this is a status announcement, and losing it
 * must never cost the clustering page that follows. Retrying it through
 * the outbox would redeliver the whole intent and re-bill the page.
 */
async function announceRunStarted(params: {
  commands: TopicClusteringOutcomeCommands;
  context: PageContext;
  occurredAt: number;
}): Promise<void> {
  const { projectId, runId, page, attempt } = params.context;
  try {
    await params.commands.recordClusteringRunStarted({
      tenantId: projectId,
      occurredAt: params.occurredAt,
      runId,
      page,
    });
  } catch (error) {
    logger.warn(
      { projectId, runId, page, attempt, error: errorText(error) },
      "Could not record clustering run start; running the page anyway (the run shows as in progress only once a page completes)",
    );
  }
}

/**
 * The final-attempt failure record. Swallow-and-log like the success path,
 * and for the same reason: the OUTCOME WRITE is never worth a redelivery.
 * This branch used to let a failing write propagate, which was strictly
 * worse than the failure it was reporting — the outbox marked the message
 * dead, so no run_failed event was ever written, `currentRun` stayed pinned
 * at this page, and the settings page showed a run stuck in progress with
 * no error on it. The asymmetry bought nothing: the retry it triggered
 * could only re-run the page that had ALREADY failed maxAttempts times.
 *
 * Swallowed, the process self-heals on the same schedule as the success
 * path — the stale-run guard abandons the pinned run after
 * TOPIC_CLUSTERING_STALE_RUN_MS and the next daily wake starts fresh.
 */
async function recordClusteringFailure(params: {
  commands: TopicClusteringOutcomeCommands;
  context: PageContext;
  occurredAt: number;
  error: unknown;
}): Promise<void> {
  const { projectId, runId, page, attempt } = params.context;
  const errorMessage = errorText(params.error);
  const classified = classifyClusteringError(params.error);
  logger.error(
    { projectId, runId, page, attempt, error: errorMessage, errorCode: classified.code },
    "Clustering page failed on final attempt; recording run_failed",
  );
  try {
    await params.commands.recordClusteringRunFailed({
      tenantId: projectId,
      occurredAt: params.occurredAt,
      runId,
      page,
      error: errorMessage,
      errorCode: classified.code,
      isUserActionable: classified.isUserActionable,
    });
  } catch (recordError) {
    logger.error(
      {
        projectId,
        runId,
        page,
        attempt,
        error: errorMessage,
        errorCode: classified.code,
        recordError: errorText(recordError),
      },
      "Clustering page failed on final attempt AND recording run_failed failed; the run stalls until the next daily wake abandons it and starts fresh",
    );
  }
}

/**
 * The completion record. The clustering work is DONE and already durable:
 * topics are written, traces assigned, a Cost row billed. Only the
 * bookkeeping is left, and it gets its own failure handling because the two
 * have opposite retry economics. Rethrowing here would hand the message back
 * to the outbox, which redelivers the whole intent — re-running embeddings
 * and LLM naming over the same page and billing it again — to fix a write
 * that costs nothing to lose. We cannot make the page cheaply replayable
 * either: the effect has no read of the run projection to short-circuit on,
 * so "already recorded" is not knowable from here.
 *
 * So: swallow the redelivery, never the signal. The failure is logged loudly
 * with the full outcome (an operator can replay the command by hand), and
 * the process self-heals within a day — `currentRun` stays pinned at this
 * page's start, the stale-run guard abandons it after
 * TOPIC_CLUSTERING_STALE_RUN_MS, and the next daily wake starts a fresh run
 * that re-derives the remaining backlog from live unassigned traces. The
 * cost of this branch is a deferred remainder, not lost or doubled work.
 */
async function recordClusteringSuccess(params: {
  commands: TopicClusteringOutcomeCommands;
  context: PageContext;
  occurredAt: number;
  outcome: ClusteringPageOutcome;
}): Promise<void> {
  const { projectId, runId, page, attempt } = params.context;
  const { outcome } = params;
  try {
    await params.commands.recordClusteringRunCompleted({
      tenantId: projectId,
      occurredAt: params.occurredAt,
      runId,
      page,
      mode: outcome.mode,
      tracesProcessed: outcome.tracesProcessed,
      topicsCount: outcome.topicsCount,
      subtopicsCount: outcome.subtopicsCount,
      ...(outcome.skippedReason
        ? { skippedReason: outcome.skippedReason }
        : {}),
      ...(outcome.nextSearchAfter
        ? { nextSearchAfter: outcome.nextSearchAfter }
        : {}),
    });
  } catch (error) {
    logger.error(
      { projectId, runId, page, attempt, error: errorText(error), outcome },
      "Clustering page succeeded but recording its outcome failed; NOT re-running the page. The run stalls until the next daily wake abandons it and starts fresh",
    );
  }
}

/**
 * The `run` intent executor (ADR-051 §4): one clustering page per dispatch.
 *
 * At-least-once + idempotent: re-running a page re-derives its work from
 * live data (unassigned traces), and the outcome commands carry
 * deterministic idempotency keys, so a redelivered intent cannot
 * double-record.
 *
 * Failure contract, split by which half failed:
 * - the CLUSTERING call — attempts below the cap rethrow so the outbox
 *   retries with backoff; the final attempt records a durable run_failed
 *   instead and retires the message dispatched, so the failure is a visible
 *   outcome rather than a dead row an operator has to find.
 * - the OUTCOME write — never retried through the outbox, on either branch,
 *   because that would redeliver the intent and re-run a page that has
 *   already either succeeded or exhausted its attempts.
 */
export function createTopicClusteringRunHandler(
  deps: TopicClusteringDispatchDeps,
): IntentExecutor<TopicClusteringRunIntent> {
  const maxAttempts = deps.maxAttempts ?? TOPIC_CLUSTERING_MAX_ATTEMPTS;
  const clock = deps.clock ?? (() => Date.now());

  return async (
    payload: TopicClusteringRunIntent,
    intentContext: IntentContext,
  ) => {
    const commands = deps.commands();
    const context: PageContext = {
      projectId: intentContext.projectId,
      runId: payload.runId,
      page: payload.page,
      attempt: intentContext.attempt,
    };

    await announceRunStarted({ commands, context, occurredAt: clock() });

    const pageStartedAtMs = clock();
    let outcome: ClusteringPageOutcome;
    try {
      outcome = await deps.runPort.runClusteringPage({
        projectId: context.projectId,
        searchAfter: payload.searchAfter,
        runId: payload.runId,
        page: payload.page,
      });
    } catch (error) {
      // Attempts below the cap rethrow so the outbox retries with backoff;
      // only the final attempt records the durable, visible failure.
      if (intentContext.attempt < maxAttempts) {
        incrementTopicClusteringPageTotal({ outcome: "failed_retryable" });
        logger.warn(
          { ...context, error: errorText(error) },
          "Clustering page failed; outbox will retry",
        );
        throw error;
      }
      // The alertable outcome (ADR-054): retries exhausted, run_failed
      // recorded. failed_retryable above is expected provider noise.
      incrementTopicClusteringPageTotal({ outcome: "failed_final" });
      await recordClusteringFailure({
        commands,
        context,
        occurredAt: clock(),
        error,
      });
      return;
    }

    incrementTopicClusteringPageTotal({
      outcome: outcome.skippedReason ? "skipped" : "completed",
    });
    observeTopicClusteringPageDuration({
      mode: outcome.mode,
      durationMs: clock() - pageStartedAtMs,
    });

    await recordClusteringSuccess({
      commands,
      context,
      occurredAt: clock(),
      outcome,
    });
  };
}
