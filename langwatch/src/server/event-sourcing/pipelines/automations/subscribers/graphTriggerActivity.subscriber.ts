import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { GraphTriggerEvaluationReason } from "~/server/app-layer/automations/graph-trigger-evaluation.service";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { Event } from "~/server/event-sourcing/domain/types";

const logger = createLogger(
  "langwatch:triggers:graph-trigger-activity-subscriber",
);

/**
 * A trigger the customer can fix themselves — a threshold pointing at a series
 * they deleted, a filter that no longer resolves. The canonical rationale for
 * keying on `fault` (and the warning that it defaults to `"customer"`, so this
 * is opt-out) lives on `isCustomerFixable` in
 * `evaluation-processing/commands/executeEvaluation.command.ts`.
 */
function isCustomerFixable(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && error.fault === "customer";
}

/** Locked ADR-034 Phase 5 real-time debounce. */
export const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

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
    let skipped = 0;
    for (const trigger of triggers) {
      try {
        await deps.evaluateGraphTrigger({
          triggerId: trigger.id,
          projectId,
          reason: "real-time",
        });
      } catch (error) {
        // A misconfigured trigger fails identically on every redelivery, so
        // counting it as a failure below bought nothing and cost a lot: the
        // event was retried until the poison guard parked the whole group,
        // and each attempt re-logged at error for every trigger in the
        // project. It is the customer's config to fix, not an incident.
        if (isCustomerFixable(error)) {
          skipped++;
          logger.info(
            {
              // `meta` first so the fixed identifiers below always win.
              ...error.meta,
              code: error.code,
              projectId,
              triggerId: trigger.id,
              error: error.message,
            },
            "graphTriggerActivity: customer-fixable trigger skipped",
          );
          continue;
        }
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
    if (skipped > 0) {
      logger.info(
        { projectId, skipped, triggers: triggers.length },
        `graphTriggerActivity: ${skipped}/${triggers.length} triggers skipped as customer-fixable`,
      );
    }
    // Throw AFTER the loop so one trigger's failure doesn't starve the
    // others, but the queue still redelivers for the failed ones —
    // TriggerSent idempotency makes the re-evaluations safe. Customer-fixable
    // skips are deliberately excluded: redelivering them cannot succeed.
    if (failures > 0) {
      throw new Error(
        `graphTriggerActivity: ${failures}/${triggers.length} evaluations failed — retry via queue redelivery`,
      );
    }
  };
}
