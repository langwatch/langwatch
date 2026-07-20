import { createLogger } from "@langwatch/observability";

import type {
  IntentContext,
  IntentExecutor,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  incrementIngestionPullTotal,
  observeIngestionPullDuration,
} from "~/server/metrics";

import {
  type IngestionPullRunIntent,
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
  run(params: {
    sourceId: string;
    cursor: string | null;
  }): Promise<{ nextCursor: string | null; eventCount: number }>;
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
}

export interface IngestionPullDispatchDeps {
  runPort: IngestionPullRunPort;
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
        retryable: true,
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
