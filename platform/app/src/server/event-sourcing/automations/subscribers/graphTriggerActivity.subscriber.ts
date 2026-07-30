import { createLogger } from "@langwatch/observability";
import type { AutomationSubscriber } from "./subscriber.types";

const logger = createLogger("langwatch:automations:graph-trigger-activity");

/**
 * `graphTriggerActivity`: the real-time half of graph-threshold alerting
 * (ADR-098 decision 1 — a plain subscriber, no state, at-most-once). Trace
 * activity nudges a project's graph triggers to re-evaluate promptly; the
 * `graphAlertSweep` process manager (`process-managers/graphAlertSweep.ts`)
 * is what makes the OUTCOME durable — it owns "no data" absence detection
 * and re-checks anything a lost nudge here would otherwise miss. That split
 * is exactly the ADR-098 decision-1 line: this subscriber's own job carries
 * no stake (a lost nudge costs latency, not correctness, because the sweep
 * backstops it), so it may be losable; the evaluator's own `TriggerSent`
 * open/resolve idempotency and the sweep's completeness are what actually
 * guarantee an alert fires.
 *
 * A 5s non-extending, non-replacing dedup window per project collapses a
 * burst of trace activity into at most one evaluation sweep per window —
 * "non-extending" is load-bearing: a window that kept extending under
 * constant traffic would never close, starving the trigger of any
 * evaluation at all.
 */

export const GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS = 5_000;
/** Replay floods, resyncs and late-arriving spans never raise a live alert
 *  through this path — the sweep is what re-checks slow-moving history. */
const MAX_AGE_MS = 60 * 60 * 1000;

export interface TraceActivityEvent {
  readonly type: string;
  readonly tenantId: string;
  readonly occurredAt: number;
}

export function graphTriggerActivityDedupId(event: TraceActivityEvent): string {
  return `graph-trigger-activity:${event.tenantId}`;
}

export interface GraphTriggerActivityPorts {
  getActiveGraphTriggers(params: {
    tenantId: string;
  }): Promise<readonly { readonly id: string }[]>;
  evaluateGraphTrigger(params: {
    triggerId: string;
    tenantId: string;
    reason: "real-time";
  }): Promise<void>;
}

/**
 * Registered once per pipeline whose activity should nudge graph triggers;
 * `eventTypes` is supplied by that mount, because "activity" means different
 * events on each source pipeline and no single pipeline sees all of them —
 * this file only owns the debounce/dedup shape and the evaluation loop.
 */
export function createGraphTriggerActivitySubscriber<E extends TraceActivityEvent>(params: {
  eventTypes: readonly string[];
  ports: GraphTriggerActivityPorts;
}): AutomationSubscriber<E> {
  return {
    name: "graphTriggerActivity",
    eventTypes: params.eventTypes,
    options: {
      delay: GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
      deduplication: {
        makeId: graphTriggerActivityDedupId,
        ttlMs: GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
        extend: false,
        replace: false,
      },
    },

    async handle(event, context): Promise<void> {
      if (event.occurredAt < Date.now() - MAX_AGE_MS) return;

      const triggers = await params.ports.getActiveGraphTriggers({
        tenantId: context.tenantId,
      });
      if (triggers.length === 0) return;

      let failures = 0;
      for (const trigger of triggers) {
        try {
          await params.ports.evaluateGraphTrigger({
            triggerId: trigger.id,
            tenantId: context.tenantId,
            reason: "real-time",
          });
        } catch (error) {
          failures++;
          logger.error(
            {
              tenantId: context.tenantId,
              triggerId: trigger.id,
              error: error instanceof Error ? error.message : String(error),
            },
            "graphTriggerActivity: evaluation failed",
          );
        }
      }
      // Thrown AFTER the loop so one trigger's failure never starves the
      // others; the (future) router's redelivery is what retries the whole
      // job, safe to repeat because the evaluator's own idempotency covers
      // an already-resolved trigger.
      if (failures > 0) {
        throw new Error(
          `graphTriggerActivity: ${failures}/${triggers.length} evaluations failed — retry via redelivery`,
        );
      }
    },
  };
}
