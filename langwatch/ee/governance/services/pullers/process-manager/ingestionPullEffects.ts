import { createLogger } from "@langwatch/observability";
import type { IntentHandler } from "~/server/event-sourcing/process-manager";
import {
  incrementIngestionPullTotal,
  observeIngestionPullDuration,
} from "~/server/metrics";
import {
  INGESTION_PULL_PROCESS_INTENT_TYPES,
  ingestionPullRunIntentSchema,
} from "./ingestionPullProcess.types";

const logger = createLogger("langwatch:governance:ingestion-pull-effects");
export const INGESTION_PULL_MAX_ATTEMPTS = 3;
export const INGESTION_PULL_LEASE_DURATION_MS = 10 * 60 * 1000;
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

export function createIngestionPullIntentHandlers(params: {
  runPort: IngestionPullRunPort;
  commands: IngestionPullOutcomeCommands;
  maxAttempts?: number;
  clock?: () => number;
}): Record<string, IntentHandler> {
  const maxAttempts = params.maxAttempts ?? INGESTION_PULL_MAX_ATTEMPTS;
  const clock = params.clock ?? (() => Date.now());

  const runHandler: IntentHandler = async ({ message }) => {
    const intent = ingestionPullRunIntentSchema.parse(message.payload);
    const pullStartedAtMs = clock();
    let result: Awaited<ReturnType<IngestionPullRunPort["run"]>>;
    try {
      result = await params.runPort.run({
        sourceId: intent.sourceId,
        cursor: intent.cursor,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (message.attempt < maxAttempts) {
        incrementIngestionPullTotal({ outcome: "failed_retryable" });
        logger.warn(
          {
            sourceId: intent.sourceId,
            attempt: message.attempt,
            error: detail,
          },
          "Ingestion pull failed; retrying from durable cursor",
        );
        throw error;
      }
      // The alertable outcome (ADR-054): retries exhausted, run_failed
      // recorded. failed_retryable above is expected provider noise.
      incrementIngestionPullTotal({ outcome: "failed_final" });
      await params.commands.recordRunFailed({
        tenantId: message.projectId,
        occurredAt: clock(),
        sourceId: intent.sourceId,
        runId: intent.runId,
        scheduledFor: intent.scheduledFor,
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
    await params.commands.recordRunCompleted({
      tenantId: message.projectId,
      occurredAt: clock(),
      sourceId: intent.sourceId,
      runId: intent.runId,
      scheduledFor: intent.scheduledFor,
      ...result,
    });
  };

  return {
    [INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]: runHandler,
  };
}
