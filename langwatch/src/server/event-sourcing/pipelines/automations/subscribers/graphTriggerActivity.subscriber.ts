import { createLogger } from "@langwatch/observability";
import type { Event } from "~/server/event-sourcing/domain/types";

import type { GraphTriggerEvaluationReason } from "~/server/app-layer/automations/graph-trigger-evaluation.service";
import type { TriggerPort } from "~/server/domain/automations/trigger.port";

const logger = createLogger(
  "langwatch:triggers:graph-trigger-activity-subscriber",
);

/** Locked ADR-034 Phase 5 real-time debounce. */
export const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

export interface GraphTriggerActivityDeps {
  triggers: TriggerPort;
  evaluateGraphTrigger: (params: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }) => Promise<void>;
}

/**
 * ADR-052: the real-time graph-alert path as a plain subscriber handler —
 * no process state: the shared evaluator owns its `TriggerSent`
 * open/resolve idempotency, queue redelivery is the retry, and the sweep
 * PM backstops anything lost. Register with a 5s NON-extending dedup
 * window per project so event bursts collapse to at most one evaluation
 * sweep per window without starving under constant traffic.
 */
export function createGraphTriggerActivityHandler(
  deps: GraphTriggerActivityDeps,
): (event: Event, context: { tenantId: string }) => Promise<void> {
  return async (event, context) => {
    const projectId = context.tenantId;

    // Old-event guard — replay floods, resyncs, late-arriving spans.
    if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;

    const triggers =
      await deps.triggers.getActiveGraphTriggersForProject(projectId);
    if (triggers.length === 0) return;

    let failures = 0;
    for (const trigger of triggers) {
      try {
        await deps.evaluateGraphTrigger({
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
  };
}
