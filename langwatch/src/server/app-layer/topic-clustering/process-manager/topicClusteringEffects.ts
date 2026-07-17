import { createLogger } from "@langwatch/observability";

import type { IntentHandler } from "~/server/event-sourcing/process-manager";
import type { ClusteringPageOutcome } from "~/server/app-layer/topic-clustering/clustering";
import { classifyClusteringError } from "../clustering-error";

import {
  TOPIC_CLUSTERING_PROCESS_INTENT_TYPES,
  topicClusteringRunIntentSchema,
} from "./topicClusteringProcess.types";

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
 * One drain leases at most this many clustering intents. Dispatch within a
 * drain is sequential, so this mainly bounds how long leased-but-waiting
 * messages sit invisible behind a slow page; cross-project throughput comes
 * from worker replicas, matching the old worker's small concurrency cap.
 */
export const TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE = 3;

/** The domain function one clustering intent executes. */
export interface TopicClusteringRunPort {
  runClusteringPage(params: {
    projectId: string;
    searchAfter: [number, string] | null;
  }): Promise<ClusteringPageOutcome>;
}

/** The pipeline commands the effect reports its outcome through. */
export interface TopicClusteringOutcomeCommands {
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
    userActionable: boolean;
  }): Promise<void>;
}

/**
 * Intent handlers for the topic clustering process outbox (ADR-051 §4).
 *
 * At-least-once + idempotent: re-running a page re-derives its work from
 * live data (unassigned traces), and the outcome commands carry
 * deterministic idempotency keys, so a redelivered intent cannot
 * double-record.
 *
 * Failure contract: attempts below the cap rethrow so the outbox retries
 * with backoff; the final attempt records a durable run_failed instead and
 * retires the message dispatched — the failure is a visible outcome, not a
 * dead row an operator has to find.
 */
export function createTopicClusteringIntentHandlers(params: {
  runPort: TopicClusteringRunPort;
  commands: TopicClusteringOutcomeCommands;
  maxAttempts?: number;
  clock?: () => number;
}): Record<string, IntentHandler> {
  const maxAttempts = params.maxAttempts ?? TOPIC_CLUSTERING_MAX_ATTEMPTS;
  const clock = params.clock ?? (() => Date.now());

  const runHandler: IntentHandler = async ({ message }) => {
    const intent = topicClusteringRunIntentSchema.parse(message.payload);
    const projectId = message.projectId;

    try {
      const outcome = await params.runPort.runClusteringPage({
        projectId,
        searchAfter: intent.searchAfter,
      });
      await params.commands.recordClusteringRunCompleted({
        tenantId: projectId,
        occurredAt: clock(),
        runId: intent.runId,
        page: intent.page,
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (message.attempt < maxAttempts) {
        logger.warn(
          { projectId, runId: intent.runId, page: intent.page, attempt: message.attempt, error: errorMessage },
          "Clustering page failed; outbox will retry",
        );
        throw error;
      }
      const classified = classifyClusteringError(error);
      logger.error(
        {
          projectId,
          runId: intent.runId,
          page: intent.page,
          attempt: message.attempt,
          error: errorMessage,
          errorCode: classified.code,
        },
        "Clustering page failed on final attempt; recording run_failed",
      );
      await params.commands.recordClusteringRunFailed({
        tenantId: projectId,
        occurredAt: clock(),
        runId: intent.runId,
        page: intent.page,
        error: errorMessage,
        errorCode: classified.code,
        userActionable: classified.userActionable,
      });
    }
  };

  return {
    [TOPIC_CLUSTERING_PROCESS_INTENT_TYPES.RUN]: runHandler,
  };
}
