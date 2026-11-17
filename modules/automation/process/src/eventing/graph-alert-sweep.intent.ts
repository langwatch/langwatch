import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";
import { type Instant, Temporal } from "@langwatch/time";
import { findWebhookReceiverFailure } from "@langwatch/webhook-contract";
import { z } from "zod";

import type { AutomationIntentRetentionRepository } from "../repositories/automation-intent-retention.repository.ts";

const logger = createLogger("langwatch:automation:graph-alert-sweep");
const SWEEP_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

export const graphAlertSweepIntentSchema = z.object({
  scheduledFor: z.number().int(),
});

export function runGraphAlertSweep(
  scheduledIntents: AutomationScheduledIntent,
  retention: AutomationIntentRetentionRepository,
): (input: z.infer<typeof graphAlertSweepIntentSchema>) => Promise<void> {
  return async (input: z.infer<typeof graphAlertSweepIntentSchema>): Promise<void> => {
    const startedAt = input.scheduledFor;
    const candidates = await scheduledIntents.decideGraphTriggerHeartbeat({
      now: Temporal.Instant.fromEpochMilliseconds(startedAt),
    });
    const failures: GraphTriggerSweepCandidate[] = [];
    for (const candidate of candidates) {
      try {
        await scheduledIntents.evaluateGraphTrigger(candidate);
      } catch (error) {
        const redeliver = reportCandidateFailure({ candidate, error });
        if (redeliver) {
          failures.push(candidate);
        }
      }
    }
    await retention.deleteDispatchedBefore({
      processName: "graphAlertSweep",
      before: startedAt - SWEEP_ROW_RETENTION_MS,
    });
    if (failures.length > 0) {
      throw new Error(
        `Graph-alert sweep failed for ${failures.length}/${candidates.length} candidates`,
      );
    }
  };
}

/**
 * Logs one failed candidate and answers whether retrying the intent could help. The
 * customer's own webhook receiver refusing is named by its status, never its body, and
 * retried only when a retry may pass (5xx, 408, 429, unreachable).
 */
function reportCandidateFailure({
  candidate,
  error,
}: {
  candidate: GraphTriggerSweepCandidate;
  error: unknown;
}): boolean {
  const where = {
    projectId: candidate.projectId,
    triggerId: candidate.triggerId,
    reason: candidate.reason,
  };
  const receiver = findWebhookReceiverFailure(error);
  if (receiver === null) {
    logger.warn(
      { ...where, error: error instanceof Error ? error.message : String(error) },
      "Graph-alert sweep candidate failed; retrying the durable intent",
    );
    return true;
  }

  logger.warn(
    { ...where, status: receiver.status, retryable: receiver.retryable },
    "Graph-alert sweep candidate refused by the automation's own webhook receiver",
  );
  return receiver.retryable;
}

export abstract class AutomationScheduledIntent {
  abstract decideGraphTriggerHeartbeat(input: {
    now: Instant;
  }): Promise<GraphTriggerSweepCandidate[]>;

  abstract evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult>;
}
