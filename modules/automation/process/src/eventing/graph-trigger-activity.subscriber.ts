import type {
  AutomationEvaluationActivityContext,
  AutomationEvaluationSubscriberEvent,
} from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { AutomationGraphActivity } from "../app/automation.members.ts";

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
      failures++;
      logger.error(
        {
          projectId,
          triggerId: trigger.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "graphTriggerActivity: evaluation failed",
      );
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

export function createGraphTriggerActivityHandler(
  automation: AutomationGraphActivity,
): (
  event: AutomationEvaluationSubscriberEvent,
  context: AutomationEvaluationActivityContext,
) => Promise<void> {
  return (event, context) => handleGraphTriggerActivity(automation, event, context);
}
