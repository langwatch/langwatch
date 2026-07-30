import { createLogger } from "@langwatch/observability";
import type { GraphTriggerEvaluationReason } from "~/server/app-layer/automations/graph-trigger-evaluation.service";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { Event } from "~/server/event-sourcing/domain/types";

const logger = createLogger(
  "langwatch:triggers:graph-trigger-activity-subscriber",
);

/**
 * Real-time debounce (ADR-034 Phase 5), widened from the original 5s.
 *
 * The handler below evaluates EVERY active graph trigger on the project, one
 * analytics query each, serially — so a sweep costs `N triggers` queries and
 * the steady-state load is `Σ(active graph triggers) ÷ this window`, a figure
 * that scales with how many alerts customers configure rather than with
 * traffic. At 5s a project holding ~100 graph alerts contributes ~20 queries a
 * second on its own, whether or not anything happened.
 *
 * 15s keeps this path meaningfully ahead of the 30s `graphAlertSweep` backstop
 * (GRAPH_TRIGGER_HEARTBEAT_INTERVAL_MS) — which is the latency floor the system
 * already guarantees — while cutting the query rate to a third. It is a dial,
 * not a fix: the shape stays O(triggers) until the sweep either batches its
 * queries or gates them on whether the delivered event could move the trigger
 * at all.
 */
export const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 15_000;

export interface GraphTriggerActivityDeps {
  triggers: TriggerService;
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
