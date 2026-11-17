import type {
  AutomationEvaluationActivityContext,
  AutomationEvaluationSubscriberEvent,
} from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { findWebhookReceiverFailure } from "@langwatch/webhook-contract";

import type { AutomationGraphActivity } from "../features/graph-alert/services/automation-graph-activity.service.ts";

const logger = createLogger("langwatch:automation:graph-trigger-activity-subscriber");

/**
 * ADR-052: the real-time graph-alert path as a plain subscriber, no
 * process state -- the shared evaluator owns idempotency, redelivery is
 * the retry, and the sweep PM backstops the rest with a 5s dedup window.
 */
export async function handleGraphTriggerActivity(
  automation: AutomationGraphActivity,
  event: AutomationEvaluationSubscriberEvent,
  context: AutomationEvaluationActivityContext,
): Promise<void> {
  const projectId = context.tenantId;

  // Old-event guard — replay floods, resyncs, late-arriving spans.
  if (event.occurredAt < nowInstant().epochMilliseconds - 60 * 60 * 1000) return;

  const triggers = await automation.getActiveGraphTriggersForProject(projectId);
  if (triggers.length === 0) return;

  let failures = 0;
  for (const trigger of triggers) {
    try {
      await automation.evaluateGraphTrigger({
        triggerId: trigger.id,
        projectId,
        reason: "real-time",
      });
    } catch (error) {
      const redeliver = reportFailure({ projectId, triggerId: trigger.id, error });
      if (redeliver) {
        failures++;
      }
    }
  }
  // Throw AFTER the loop so one trigger's failure doesn't starve the
  // others, but the queue still redelivers for the failed ones —
  // TriggerSent idempotency makes the re-evaluations safe.
  if (failures > 0) {
    throw new Error(
      `graphTriggerActivity: ${failures}/${triggers.length} evaluations failed — retry via queue redelivery`,
    );
  }
}

/**
 * Logs one failed evaluation and answers whether redelivery could help. A failure the
 * customer's own webhook receiver caused is theirs, not ours: a warning naming its status,
 * never its body, redelivered only when a retry may pass (5xx, 408, 429, unreachable).
 */
function reportFailure({
  projectId,
  triggerId,
  error,
}: {
  projectId: string;
  triggerId: string;
  error: unknown;
}): boolean {
  const receiver = findWebhookReceiverFailure(error);
  if (receiver === null) {
    logger.error(
      { projectId, triggerId, error: error instanceof Error ? error.message : String(error) },
      "graphTriggerActivity: evaluation failed",
    );
    return true;
  }

  logger.warn(
    { projectId, triggerId, status: receiver.status, retryable: receiver.retryable },
    "graphTriggerActivity: the automation's own webhook receiver refused the alert",
  );
  return receiver.retryable;
}

export function createGraphTriggerActivityHandler(
  automation: AutomationGraphActivity,
): (
  event: AutomationEvaluationSubscriberEvent,
  context: AutomationEvaluationActivityContext,
) => Promise<void> {
  return (event, context) => handleGraphTriggerActivity(automation, event, context);
}
