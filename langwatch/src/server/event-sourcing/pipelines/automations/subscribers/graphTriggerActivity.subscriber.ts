import { createLogger } from "@langwatch/observability";
import type { GraphTriggerEvaluationReason } from "~/server/app-layer/automations/graph-trigger-evaluation.service";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { Event } from "~/server/event-sourcing/domain/types";
import { isDispatchError } from "~/server/event-sourcing/queues/dispatchError";

const logger = createLogger(
  "langwatch:triggers:graph-trigger-activity-subscriber",
);

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
    let terminal = 0;
    for (const trigger of triggers) {
      try {
        await deps.evaluateGraphTrigger({
          triggerId: trigger.id,
          projectId,
          reason: "real-time",
        });
      } catch (error) {
        // A trigger the evaluator has already judged terminal — a Slack
        // connection missing its token, a revoked webhook — fails identically
        // on every redelivery. Counting it below bought nothing and cost a
        // lot: the event was retried until the poison guard parked the whole
        // group, and every attempt re-logged at error for every trigger in the
        // project.
        //
        // `retryable` is the thrower's own explicit decision (ADR-027), and it
        // is safe by default in the right direction: anything that is not a
        // DispatchError — an unexpected crash, a DB outage — is retryable by
        // contract, so it falls through to the error branch below rather than
        // being quietly demoted. Do NOT widen this to a general fault lookup:
        // classifications that default to "customer" would silently swallow
        // our own failures here.
        if (isDispatchError(error) && !error.retryable) {
          terminal++;
          logger.info(
            {
              projectId,
              triggerId: trigger.id,
              // The customer-facing sentence when the rejection had one; the
              // full diagnostic always stays in `error`.
              ...(error.customerMessage
                ? { customerMessage: error.customerMessage }
                : {}),
              error: error.message,
            },
            "graphTriggerActivity: trigger cannot be delivered until reconfigured",
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
    if (terminal > 0) {
      logger.info(
        { projectId, terminal, triggers: triggers.length },
        `graphTriggerActivity: ${terminal}/${triggers.length} triggers need reconfiguring`,
      );
    }
    // Throw AFTER the loop so one trigger's failure doesn't starve the
    // others, but the queue still redelivers for the failed ones —
    // TriggerSent idempotency makes the re-evaluations safe. Terminal
    // rejections are deliberately excluded: redelivering them cannot succeed.
    if (failures > 0) {
      throw new Error(
        `graphTriggerActivity: ${failures}/${triggers.length} evaluations failed — retry via queue redelivery`,
      );
    }
  };
}
