import { createLogger } from "@langwatch/observability";

import type {
  IntentContext,
  IntentExecutor,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  incrementIngestionPullTotal,
  observeIngestionPullDuration,
} from "~/server/metrics";

import { AGENT_LISTING_FAILED_REASON } from "../schemas/constants";
import type {
  IngestionPullAgentListingIntent,
  IngestionPullRunIntent,
} from "./ingestionPullProcess.types";

const logger = createLogger("langwatch:governance:ingestion-pull-effects");

export const INGESTION_PULL_MAX_ATTEMPTS = 3;

/**
 * The lease must outlive the slowest healthy pull, or a second dispatcher
 * re-leases the row mid-flight and runs the same window concurrently.
 */
export const INGESTION_PULL_LEASE_DURATION_MS = 10 * 60 * 1000;

/**
 * Leased per drain AND dispatched concurrently (the pipeline declares both):
 * pulls for distinct sources are independent, and bounding the lease batch
 * to the same number keeps leased-but-waiting messages from sitting
 * invisible behind a slow provider for the whole lease.
 */
export const INGESTION_PULL_CONCURRENCY = 4;

export interface IngestionPullRunPort {
  run(params: { sourceId: string; cursor: string | null }): Promise<{
    nextCursor: string | null;
    eventCount: number;
    /**
     * Input the run could not read while still advancing past it. Required
     * rather than optional so a partial success cannot reach the durable
     * completion as a clean one by a port simply omitting the field.
     */
    errorCount: number;
  }>;
}

/**
 * One on-demand agent listing for one source.
 *
 * Takes only the source id, like `IngestionPullRunPort.run`: the adapter
 * resolves the organization and the credential, so tenancy stays out of the
 * process state and out of the intent payload.
 *
 * `listed` and `empty` collapse into one arm here on purpose. A refusal is
 * its own arm and can never carry a count, so `agentCount: 0` on this side
 * means the provider answered and named none, and cannot mean anything else.
 */
export interface AgentListingPort {
  list(params: {
    sourceId: string;
  }): Promise<
    | { outcome: "listed"; agentCount: number }
    | { outcome: "refused"; reason: string; status: number | null }
  >;
}

/** The pipeline commands the effect reports its outcome through. */
export interface IngestionPullOutcomeCommands {
  recordRunCompleted(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    nextCursor: string | null;
    eventCount: number;
    errorCount: number;
  }): Promise<void>;
  recordRunFailed(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    error: string;
    errorCode: string;
    retryable: boolean;
  }): Promise<void>;
  recordAgentsListed(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    requestId: string;
    requestedAt: number;
    agentCount: number;
  }): Promise<void>;
  recordAgentsListingRefused(args: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    requestId: string;
    requestedAt: number;
    reason: string;
    status: number | null;
  }): Promise<void>;
}

export interface IngestionPullDispatchDeps {
  runPort: IngestionPullRunPort;
  agentListingPort: AgentListingPort;
  /**
   * Late-bound on purpose: the executor is declared while the pipeline is
   * being built, and these are the SAME pipeline's commands — they only
   * exist after `.build()`. The composition root supplies a getter it
   * resolves post-build; dispatch happens long after that.
   */
  commands: () => IngestionPullOutcomeCommands;
  maxAttempts?: number;
  clock?: () => number;
}

/**
 * The `run` intent executor: one pull attempt per dispatch, from the durable
 * cursor the intent carries.
 *
 * At-least-once + idempotent: a redelivered intent re-pulls from the same
 * durable cursor, and the outcome commands carry deterministic idempotency
 * keys, so it cannot double-record.
 */
export function createIngestionPullRunHandler(
  deps: IngestionPullDispatchDeps,
): IntentExecutor<IngestionPullRunIntent> {
  const maxAttempts = deps.maxAttempts ?? INGESTION_PULL_MAX_ATTEMPTS;
  const clock = deps.clock ?? (() => Date.now());

  return async (
    payload: IngestionPullRunIntent,
    intentContext: IntentContext,
  ) => {
    const commands = deps.commands();
    const pullStartedAtMs = clock();
    let result: Awaited<ReturnType<IngestionPullRunPort["run"]>>;
    try {
      result = await deps.runPort.run({
        sourceId: payload.sourceId,
        cursor: payload.cursor,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (intentContext.attempt < maxAttempts) {
        incrementIngestionPullTotal({ outcome: "failed_retryable" });
        logger.warn(
          {
            sourceId: payload.sourceId,
            attempt: intentContext.attempt,
            error: detail,
          },
          "Ingestion pull failed; retrying from durable cursor",
        );
        throw error;
      }
      // The alertable outcome (ADR-054): retries exhausted, run_failed
      // recorded. failed_retryable above is expected provider noise.
      incrementIngestionPullTotal({ outcome: "failed_final" });
      await commands.recordRunFailed({
        tenantId: intentContext.projectId,
        occurredAt: clock(),
        sourceId: payload.sourceId,
        runId: payload.runId,
        scheduledFor: payload.scheduledFor,
        error: detail,
        errorCode: "pull_failed",
        // Retries are exhausted — nothing will retry THIS run. The next
        // scheduled wake starts a fresh run from the durable cursor.
        retryable: false,
      });
      return;
    }
    incrementIngestionPullTotal({ outcome: "completed" });
    observeIngestionPullDuration({ durationMs: clock() - pullStartedAtMs });
    // Keep outcome-command failures distinct from provider failures. If this
    // write fails, the outbox redelivers the idempotent effect; it must not
    // turn a successful pull into a run_failed event on the final attempt.
    await commands.recordRunCompleted({
      tenantId: intentContext.projectId,
      occurredAt: clock(),
      sourceId: payload.sourceId,
      runId: payload.runId,
      scheduledFor: payload.scheduledFor,
      ...result,
    });
  };
}

/**
 * Rethrows a listing failure while attempts remain, and returns once they are
 * spent so the caller can record the outcome.
 *
 * Split out because the retry decision and the recording decision are two
 * different judgements: this one is about whether trying again could help.
 */
function retryOrGiveUp({
  error,
  intentContext,
  maxAttempts,
  payload,
}: {
  error: unknown;
  intentContext: IntentContext;
  maxAttempts: number;
  payload: IngestionPullAgentListingIntent;
}): void {
  if (intentContext.attempt >= maxAttempts) return;
  logger.warn(
    {
      sourceId: payload.sourceId,
      requestId: payload.requestId,
      attempt: intentContext.attempt,
      error: error instanceof Error ? error.message : String(error),
    },
    "Agent listing failed; retrying",
  );
  throw error;
}

/**
 * The `listAgents` intent executor: one listing per dispatch.
 *
 * At-least-once + idempotent, like the pull. A redelivered intent re-lists
 * and re-records the same sightings, which the sighting repository absorbs,
 * and the outcome commands carry deterministic idempotency keys, so a
 * redelivery cannot write a second outcome event for one request.
 *
 * Three outcomes reach the log, not two. A provider that refuses is not a
 * failed effect: the listing did its job and found out the answer is no, so
 * it records that and does not retry. Only our own side giving out is worth
 * a retry, and only that becomes a `listing_failed` refusal once retries run
 * out — kept apart from the provider's own reasons so a reader is never told
 * to go fix a credential that was fine.
 */
export function createAgentListingHandler(
  deps: IngestionPullDispatchDeps,
): IntentExecutor<IngestionPullAgentListingIntent> {
  const maxAttempts = deps.maxAttempts ?? INGESTION_PULL_MAX_ATTEMPTS;
  const clock = deps.clock ?? (() => Date.now());

  return async (
    payload: IngestionPullAgentListingIntent,
    intentContext: IntentContext,
  ) => {
    const commands = deps.commands();
    const outcomeEnvelope = {
      tenantId: intentContext.projectId,
      sourceId: payload.sourceId,
      requestId: payload.requestId,
      requestedAt: payload.requestedAt,
    };

    let result: Awaited<ReturnType<AgentListingPort["list"]>>;
    try {
      result = await deps.agentListingPort.list({
        sourceId: payload.sourceId,
      });
    } catch (error) {
      // Rethrows below the cap so the outbox retries; at the cap it records
      // the one refusal that means "we could not ask" and returns.
      retryOrGiveUp({ error, intentContext, maxAttempts, payload });
      // The message stayed in the log line and out of the event: a thrown
      // provider error can carry a response body, and this event is read by
      // an admin. The reason code is enough to act on.
      await commands.recordAgentsListingRefused({
        ...outcomeEnvelope,
        occurredAt: clock(),
        reason: AGENT_LISTING_FAILED_REASON,
        status: null,
      });
      return;
    }

    if (result.outcome === "refused") {
      await commands.recordAgentsListingRefused({
        ...outcomeEnvelope,
        occurredAt: clock(),
        reason: result.reason,
        status: result.status,
      });
      return;
    }

    await commands.recordAgentsListed({
      ...outcomeEnvelope,
      occurredAt: clock(),
      agentCount: result.agentCount,
    });
  };
}
