import { createLogger } from "@langwatch/observability";
import type {
  AutomationEvaluationActivityContext,
  AutomationEvaluationSubscriberEvent,
} from "@langwatch/automation-contract";
import type { AutomationGraphActivity } from "../app/automation.members.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:automation:graph-trigger-activity-subscriber");

/** Locked ADR-034 Phase 5 real-time debounce. */
export const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

/**
 * Per-tenant queue lane serializes graph-trigger sweeps; per-trace grouping
 * previously caused concurrent sweep storms saturating ClickHouse selects.
 */
export function graphTriggerActivityGroupKey(event: { tenantId: string }): string {
  return `graph-trigger-activity:${event.tenantId}`;
}

/**
 * ADR-052: the real-time graph-alert path as a plain subscriber handler —
 * no process state: the shared evaluator owns its `TriggerSent`
 * open/resolve idempotency, queue redelivery is the retry, and the sweep
 * PM backstops anything lost. Register with a 5s NON-extending dedup
 * window per project so event bursts collapse to at most one evaluation
 * sweep per window without starving under constant traffic.
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
