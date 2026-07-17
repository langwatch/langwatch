import { createLogger } from "@langwatch/observability";
import type { Event } from "~/server/event-sourcing/domain/types";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";

import type { GraphTriggerEvaluationReason } from "../graph-trigger-evaluation.service";
import type { TriggerService } from "../trigger.service";

const logger = createLogger(
  "langwatch:triggers:graph-trigger-activity-subscriber",
);

/** Locked ADR-034 Phase 5 real-time debounce. */
export const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

export interface GraphTriggerActivitySubscriberDeps {
  triggers: TriggerService;
  evaluateGraphTrigger: (params: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }) => Promise<void>;
}

/**
 * ADR-052: the real-time graph-alert path as an event subscriber — replaces
 * the `graphTriggerEvaluation` `.withOutbox` reactors on both pipelines. No
 * process state: the shared evaluator owns its `TriggerSent` open/resolve
 * idempotency, GroupQueue redelivery is the retry, and the 5s
 * NON-extending dedup window collapses event bursts to at most one
 * evaluation sweep per project per window (the legacy per-trigger Debounce
 * TTL, one level coarser). `extend: false` matters: an extending window
 * would starve evaluation under constant traffic.
 */
export function createGraphTriggerActivitySubscriber<E extends Event>(params: {
  /** Distinguishes the trace- and evaluation-pipeline registrations. */
  pipeline: "trace" | "evaluation";
  eventTypes: readonly string[];
  deps: GraphTriggerActivitySubscriberDeps;
}): EventSubscriberDefinition<E> {
  const { deps } = params;
  return {
    name: `graphTriggerActivity-${params.pipeline}`,
    eventTypes: params.eventTypes,
    options: {
      delay: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
      deduplication: {
        makeId: (event) =>
          `graph-trigger-activity:${params.pipeline}:${event.tenantId}`,
        ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
        // Collapse-within-window, do NOT debounce-extend: constant traffic
        // must still evaluate every window.
        extend: false,
        replace: false,
      },
    },
    handle: async (event, context) => {
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
    },
  };
}
