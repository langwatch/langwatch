import { createLogger } from "@langwatch/observability";
import type { GraphTriggerEvaluationReason } from "~/server/app-layer/automations/graph-trigger-evaluation.service";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { Event } from "~/server/event-sourcing.old/domain/types";
import type { EventSubscriberDefinition } from "~/server/event-sourcing.old/subscribers/eventSubscriber.types";

const logger = createLogger(
  "langwatch:triggers:graph-trigger-activity-subscriber",
);

/** Locked ADR-099 real-time debounce. */
export const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

/**
 * The dedup key. Exported so a mount can assert what it is collapsing on, and
 * so the one string that must never drift lives in exactly one place: change it
 * and a rolling deploy runs the old and new keys side by side, double-firing
 * every project's trigger evaluation for the length of the rollout.
 */
export function graphTriggerActivityDedupId(event: Event): string {
  return `graph-trigger-activity:${String(event.tenantId)}`;
}

interface GraphTriggerActivityDeps {
  triggers: TriggerService;
  evaluateGraphTrigger: (params: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }) => Promise<void>;
}

/**
 * ADR-098: the real-time graph-alert path as a plain subscriber handler —
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

/**
 * The real-time graph-alert subscriber, authored once for the several pipelines
 * that mount it. The debounce is the whole economics of the thing, so it lives
 * here rather than in each mount: a 5s NON-extending, NON-replacing dedup window
 * per project collapses a burst of events into at most one evaluation sweep per
 * window, and refusing to extend is what stops a project under constant traffic
 * from starving — the window closes on schedule and the next event opens a fresh
 * one. The matching `delay` holds the job for that same window so the sweep runs
 * once the burst has actually landed.
 *
 * Each mount supplies its own `eventTypes`, because "activity" means different
 * events on each pipeline and no single pipeline sees all of them.
 */
export function createGraphTriggerActivitySubscriber<
  E extends Event = Event,
>(deps: {
  /** The activity events on the pipeline this is mounted on. */
  eventTypes: readonly string[];
  /** Usually `createGraphTriggerActivityHandler(...)`, injected by the mount. */
  handler: (event: E, context: { tenantId: string }) => Promise<void>;
}): EventSubscriberDefinition<E> {
  return {
    name: "graphTriggerActivity",
    eventTypes: deps.eventTypes,
    options: {
      delay: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
      deduplication: {
        makeId: graphTriggerActivityDedupId,
        ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
        extend: false,
        replace: false,
      },
    },
    handle: (event, context) => deps.handler(event, context),
  };
}
