import { createLogger } from "@langwatch/observability";
import type { GraphTriggerEvaluationReason } from "~/server/app-layer/automations/graph-trigger-evaluation.service";
import type { TriggerSummary } from "~/server/app-layer/automations/repositories/trigger.repository";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { Event } from "~/server/event-sourcing/domain/types";

const logger = createLogger(
  "langwatch:triggers:graph-trigger-activity-subscriber",
);

/** Locked ADR-034 Phase 5 real-time debounce. */
export const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

/**
 * One queue lane per tenant for graph-trigger sweeps.
 *
 * Without this the subscriber inherited per-aggregate (per-trace) groups, so
 * the 5s dedup only bounded how fast sweep jobs were STAGED — jobs staged
 * across successive windows landed in different trace-keyed groups and
 * dispatched concurrently. Under sustained traffic that stacked into a
 * parallel sweep storm: measured 2026-07-31, ~85 concurrent sweeps for one
 * tenant (~8/s where the debounce intends 0.2/s), each a multi-hundred-MiB
 * analytics query, saturating ClickHouse selects fleet-wide.
 *
 * A sweep evaluates the tenant's CURRENT trigger state — running two
 * concurrently is pure waste — so all of a tenant's sweeps belong in one
 * serialized lane. Queued deliveries then drain one at a time, and a backlog
 * of stale sweep jobs degrades to cheap sequential re-evaluations. The queue
 * prefixes `<tenantId>/subscriber/graphTriggerActivity/` around this key.
 */
export function graphTriggerActivityGroupKey(event: {
  tenantId: string;
}): string {
  return `graph-trigger-activity:${event.tenantId}`;
}

export interface GraphTriggerActivityDeps {
  triggers: TriggerService;
  evaluateGraphTrigger: (params: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }) => Promise<void>;
}

async function evaluateActiveGraphTriggers({
  deps,
  triggers,
  projectId,
}: {
  deps: GraphTriggerActivityDeps;
  triggers: TriggerSummary[];
  projectId: string;
}): Promise<number> {
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
  return failures;
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

    const failures = await evaluateActiveGraphTriggers({
      deps,
      triggers,
      projectId,
    });
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
