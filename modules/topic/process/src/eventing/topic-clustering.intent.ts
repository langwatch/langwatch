import type { IntentContext, IntentExecutor, IntentSpec } from "@langwatch/eventing";
import { defineCommand } from "@langwatch/eventing";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  CLUSTERING_ERROR_CODES,
  ClusteringError,
  type ClassifiedClusteringError,
  topicClusteringRequestedEventDataSchema,
  topicClusteringRunCompletedEventDataSchema,
  topicClusteringRunFailedEventDataSchema,
  topicClusteringRunStartedEventDataSchema,
  topicClusteringSearchAfterSchema,
  topicClusteringTopicsRecordedEventDataSchema,
  type TopicClusteringRunMode,
  type TopicClusteringSearchAfter,
  type TopicClusteringSkipReason,
} from "@langwatch/topic-contract";
import { z } from "zod";

const logger = createLogger("langwatch:topic-clustering:process-effects");

/**
 * Classifies a clustering failure by TYPE, never by message text (ADR-051;
 * see topic-clustering.errors.ts for why).
 */
export function classifyClusteringError(error: unknown): ClassifiedClusteringError {
  if (error instanceof ClusteringError) {
    return { code: error.code, isUserActionable: error.isUserActionable };
  }
  // Raised by the model-resolution cascade itself, which already knows exactly
  // which feature and role had nothing set. It is thrown from shared code we
  // do not own, so it is matched here by type rather than re-wrapped at every
  // call site — still a type, still not a string.
  if (error instanceof ModelNotConfiguredError) {
    return {
      code: CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
      isUserActionable: true,
    };
  }
  // Unattributed: a bug, a dependency we did not wrap, an members
  // failure. Fail closed — we do not tell someone their configuration is
  // broken on the strength of not recognising an error.
  return { code: CLUSTERING_ERROR_CODES.INTERNAL, isUserActionable: false };
}

/**
 * Topic-clustering-processing commands, each defined from its event data
 * schema (ADR-051 §1). Aggregate = project, so per-project commands fold
 * and subscribe in FIFO order.
 */

export const RequestTopicClusteringCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.request",
  eventType: "lw.obs.topic_clustering.requested",
  eventVersion: "2026-07-17",
  aggregateType: "topic_clustering",
  schema: topicClusteringRequestedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  // Bootstrap is once-per-project (re-sends collapse in the event log and
  // are harmless to the process); manual requests are each their own ask.
  idempotencyKey: (d) =>
    d.trigger === "bootstrap"
      ? `${String(d.tenantId)}:topic_clustering:bootstrap`
      : `${String(d.tenantId)}:topic_clustering:request:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.trigger": d.trigger,
  }),
  makeJobId: (d) =>
    d.trigger === "bootstrap"
      ? `${String(d.tenantId)}:topic_clustering:bootstrap`
      : `${String(d.tenantId)}:topic_clustering:request:${d.occurredAt}`,
});

export const RecordClusteringRunStartedCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.record_run_started",
  eventType: "lw.obs.topic_clustering.run_started",
  eventVersion: "2026-07-19",
  aggregateType: "topic_clustering",
  schema: topicClusteringRunStartedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  // Keyed per page, so a redelivered intent re-announces the same page
  // rather than appending a second start for it.
  idempotencyKey: (d) => `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:started`,
  spanAttributes: (d) => ({
    "payload.run_id": d.runId,
    "payload.page": d.page,
  }),
  makeJobId: (d) => `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:started`,
});

export const RecordClusteringRunCompletedCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.record_run_completed",
  eventType: "lw.obs.topic_clustering.run_completed",
  eventVersion: "2026-07-17",
  aggregateType: "topic_clustering",
  schema: topicClusteringRunCompletedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  idempotencyKey: (d) =>
    `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:completed`,
  spanAttributes: (d) => ({
    "payload.run_id": d.runId,
    "payload.page": d.page,
    "payload.mode": d.mode,
    "payload.traces_processed": d.tracesProcessed,
  }),
  makeJobId: (d) => `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:completed`,
});

export const RecordClusteringRunFailedCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.record_run_failed",
  eventType: "lw.obs.topic_clustering.run_failed",
  eventVersion: "2026-07-17",
  aggregateType: "topic_clustering",
  schema: topicClusteringRunFailedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  idempotencyKey: (d) => `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:failed`,
  spanAttributes: (d) => ({
    "payload.run_id": d.runId,
    "payload.page": d.page,
  }),
  makeJobId: (d) => `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:failed`,
});

/**
 * One key for both the event idempotencyKey and the enqueue dedup id, so a
 * redelivered page or a re-run seed collapses instead of appending again.
 * Exported for the pipeline's `deduplication.makeId` wiring.
 */
export const recordTopicsDedupeId = (d: { tenantId: PropertyKey; dedupeKey: string }): string =>
  `${String(d.tenantId)}:topic_clustering:topics:${d.dedupeKey}`;

export const RecordTopicsCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.record_topics",
  eventType: "lw.obs.topic_clustering.topics_recorded",
  eventVersion: "2026-07-20",
  aggregateType: "topic_clustering",
  schema: topicClusteringTopicsRecordedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  // Keyed by the caller's dedupeKey (`run:<id>:page-<n>` / `seed:v1`).
  idempotencyKey: recordTopicsDedupeId,
  spanAttributes: (d) => ({
    "payload.mode": d.mode,
    "payload.source": d.source,
    "payload.topics_count": d.topics.length,
  }),
  makeJobId: recordTopicsDedupeId,
});

export const TOPIC_CLUSTERING_PROCESS_INTENT_TYPES = {
  /**
   * Run one clustering page for the project. Property-style like the other
   * builder-mounted domains (`ctx.intents.run(...)`); outbox rows scope
   * intentType by processName, so the short name stays unambiguous.
   */
  RUN: "run",
} as const;

/**
 * The clustering run intent payload. `searchAfter` is null for the first
 * page; continuation intents carry the cursor the previous page returned.
 */
export const topicClusteringRunIntentSchema = z.object({
  runId: z.string(),
  page: z.number(),
  searchAfter: topicClusteringSearchAfterSchema.nullable(),
});
export type TopicClusteringRunIntent = z.infer<typeof topicClusteringRunIntentSchema>;

/** The intents this process may emit; typed so handlers get `ctx.intents.run`. */
export type TopicClusteringIntents = {
  run: IntentSpec<typeof topicClusteringRunIntentSchema>;
};

/**
 * Delivery attempts before the run is recorded as failed: 3 attempts, with
 * exponential backoff between them.
 */
export const TOPIC_CLUSTERING_MAX_ATTEMPTS = 3;

/**
 * The lease must OUTLIVE the slowest healthy clustering page, or a second
 * dispatcher re-runs it mid-flight. A page can take minutes (up to 2000
 * traces through langevals), so the generic 30s default is unsafe.
 */
export const TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS = 20 * 60 * 1000;

/**
 * The effective clustering concurrency (ADR-051 §4), matching the old
 * worker's cap of 3. Bounding the lease batch to the same number keeps
 * waiting messages from sitting invisible behind a slow page.
 */
export const TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE = 3;

/**
 * What one clustering page did (ADR-051). `nextSearchAfter` present means
 * more pages remain — the caller owns continuing the walk; the run port
 * never schedules its own next page.
 */
export interface TopicClusteringPageOutcome {
  mode: TopicClusteringRunMode;
  tracesProcessed: number;
  topicsCount: number;
  subtopicsCount: number;
  skippedReason?: TopicClusteringSkipReason;
  nextSearchAfter?: TopicClusteringSearchAfter;
}

/** The domain function one clustering intent executes. */
export interface TopicClusteringRun {
  runClusteringPage(params: {
    projectId: string;
    searchAfter: [number, string] | null;
    /** Logical run identity; keys the recordTopics dedupe per page. */
    runId: string;
    page: number;
  }): Promise<TopicClusteringPageOutcome>;
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
    mode: TopicClusteringPageOutcome["mode"];
    tracesProcessed: number;
    topicsCount: number;
    subtopicsCount: number;
    skippedReason?: TopicClusteringPageOutcome["skippedReason"];
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

/**
 * Failure classification port (ADR-051 §8): the classifier lives with the
 * clustering execution that OWNS the failure taxonomy (the app-layer
 * composition wires it in); the intent handler only consumes its verdict.
 */
export type TopicClusteringErrorClassifier = (error: unknown) => ClassifiedClusteringError;

/**
 * The page-execution metrics the executor reports (ADR-054). The concrete
 * counters live in the app's metrics module; composition wires them in.
 */
export interface TopicClusteringMetrics {
  incrementPageTotal(params: {
    outcome: "completed" | "skipped" | "failed_customer" | "failed_retryable" | "failed_final";
  }): void;
  observePageDuration(params: { mode: TopicClusteringRunMode; durationMs: number }): void;
}

export interface TopicClusteringDispatchDeps {
  runPort: TopicClusteringRun;
  /**
   * Late-bound on purpose: the executor is declared while the pipeline is
   * still being built, and these are that SAME pipeline's commands — they
   * only exist after `.build()`, which the registry resolves post-build.
   */
  commands: TopicClusteringOutcomeCommands;
  classifyError: TopicClusteringErrorClassifier;
  metrics: TopicClusteringMetrics;
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

// Announce the page before working it so "a run is in progress" is recorded; best-effort so
// losing it doesn't cost the clustering page.
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

// Final-attempt failure record; swallowed so outcome write failure doesn't re-run exhausted page.
// Process self-heals when stale-run guard abandons the run and next daily wake starts fresh.
async function recordClusteringFailure(params: {
  commands: TopicClusteringOutcomeCommands;
  context: PageContext;
  occurredAt: number;
  error: unknown;
  /** Classified by the caller, which already had to ask to pick its branch. */
  classified: ClassifiedClusteringError;
}): Promise<void> {
  const { projectId, runId, page, attempt } = params.context;
  const errorMessage = errorText(params.error);
  const { classified } = params;
  // A user-actionable failure is the customer's to fix, not an incident of
  // ours — it logs at warn, while an internal failure stays at error.
  logger[classified.isUserActionable ? "warn" : "error"](
    {
      projectId,
      runId,
      page,
      attempt,
      error: errorMessage,
      errorCode: classified.code,
    },
    classified.isUserActionable
      ? "Clustering run needs customer action; recording run_failed with its code for the settings page"
      : "Clustering page failed on final attempt; recording run_failed",
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

// Completion record; work is durable (topics written, traces assigned). Swallow outcome-write
// failures (opposite retry economics); process self-heals when stale-run guard starts a fresh run.
async function recordClusteringSuccess(params: {
  commands: TopicClusteringOutcomeCommands;
  context: PageContext;
  occurredAt: number;
  outcome: TopicClusteringPageOutcome;
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
      ...(outcome.skippedReason ? { skippedReason: outcome.skippedReason } : {}),
      ...(outcome.nextSearchAfter ? { nextSearchAfter: outcome.nextSearchAfter } : {}),
    });
  } catch (error) {
    logger.error(
      { projectId, runId, page, attempt, error: errorText(error), outcome },
      "Clustering page succeeded but recording its outcome failed; NOT re-running the page. The run stalls until the next daily wake abandons it and starts fresh",
    );
  }
}

// The `run` intent executor (ADR-051 §4): one clustering page per dispatch.
// At-least-once + idempotent; outcome commands carry deterministic idempotency keys.
export function createTopicClusteringRunHandler(
  deps: TopicClusteringDispatchDeps,
): IntentExecutor<TopicClusteringRunIntent> {
  const maxAttempts = deps.maxAttempts ?? TOPIC_CLUSTERING_MAX_ATTEMPTS;
  const clock = deps.clock ?? (() => nowInstant().epochMilliseconds);

  return async (payload: TopicClusteringRunIntent, intentContext: IntentContext) => {
    const commands = deps.commands;
    const context: PageContext = {
      projectId: intentContext.projectId,
      runId: payload.runId,
      page: payload.page,
      attempt: intentContext.attempt,
    };

    await announceRunStarted({ commands, context, occurredAt: clock() });

    const pageStartedAtMs = clock();
    let outcome: TopicClusteringPageOutcome;
    try {
      outcome = await deps.runPort.runClusteringPage({
        projectId: context.projectId,
        searchAfter: payload.searchAfter,
        runId: payload.runId,
        page: payload.page,
      });
    } catch (error) {
      // A user-actionable failure (no model configured, rejected credentials)
      // cannot be fixed by retrying — only the customer changing their
      // configuration can. Record the durable, visible outcome immediately
      // instead of burning the retry budget re-asking the same question.
      const classified = deps.classifyError(error);
      if (classified.isUserActionable) {
        deps.metrics.incrementPageTotal({ outcome: "failed_customer" });
        await recordClusteringFailure({
          commands,
          context,
          occurredAt: clock(),
          error,
          classified,
        });
        return;
      }
      // Attempts below the cap rethrow so the outbox retries with backoff;
      // only the final attempt records the durable, visible failure.
      if (intentContext.attempt < maxAttempts) {
        deps.metrics.incrementPageTotal({ outcome: "failed_retryable" });
        logger.warn(
          { ...context, error: errorText(error) },
          "Clustering page failed; outbox will retry",
        );
        throw error;
      }
      // The alertable outcome (ADR-054): retries exhausted, run_failed
      // recorded. failed_retryable above is expected provider noise.
      deps.metrics.incrementPageTotal({ outcome: "failed_final" });
      await recordClusteringFailure({
        commands,
        context,
        occurredAt: clock(),
        error,
        classified,
      });
      return;
    }

    deps.metrics.incrementPageTotal({
      outcome: outcome.skippedReason ? "skipped" : "completed",
    });
    deps.metrics.observePageDuration({
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
