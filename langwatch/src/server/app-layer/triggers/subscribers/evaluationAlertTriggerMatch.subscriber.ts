import { createLogger } from "@langwatch/observability";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/constants";
import type { EvaluationProcessingEvent } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";

import {
  NOTIFY_TRIGGER_ACTIONS,
  triggerReadsEvaluations,
} from "../dispatch/triggerActionDispatch";
import { toTriggerMatchEnvelope } from "../process-manager/triggerSettlementProcess.definition";
import type { TriggerMatchEventView } from "../process-manager/triggerSettlementProcess.types";
import type { TriggerService } from "../trigger.service";
import type { TriggerSettlementProcessPort } from "./types";

const logger = createLogger(
  "langwatch:triggers:evaluation-alert-trigger-match-subscriber",
);

export interface EvaluationAlertTriggerMatchSubscriberDeps {
  triggers: TriggerService;
  /** Terminal status + traceId come from the evaluation-run fold — the
   *  completed event itself carries no traceId. */
  evaluationRunStore: FoldProjectionStore<EvaluationRunData>;
  /** Existence guard only — dispatch re-reads the fold at fire time. */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  settlement: TriggerSettlementProcessPort;
  notifyOutbox?: () => void;
  clock?: () => number;
}

/**
 * ADR-052: evaluation-side alert-trigger match detection as an event
 * subscriber — replaces the `evaluationAlertTrigger` (persist) and
 * `evaluationAlertTriggerNotifyOutbox` (notify) `.withOutbox` reactors.
 * Owns every active trigger whose subject reads evaluation results; the
 * trace-side subscriber leaves those to this one, and the at-most-once
 * `TriggerSent` claim dedupes the two pipelines' matches at dispatch.
 */
export function createEvaluationAlertTriggerMatchSubscriber(
  deps: EvaluationAlertTriggerMatchSubscriberDeps,
): EventSubscriberDefinition<EvaluationProcessingEvent> {
  const clock = deps.clock ?? (() => Date.now());
  return {
    name: "evaluationAlertTriggerMatch",
    eventTypes: [
      EVALUATION_COMPLETED_EVENT_TYPE,
      EVALUATION_REPORTED_EVENT_TYPE,
    ],
    options: {
      // The legacy reactor's window: 10s delay for the evaluation-run fold
      // to converge, 30s per-evaluation debounce.
      delay: 10_000,
      deduplication: {
        makeId: (event) =>
          `evaluation-alert-trigger-match:${event.tenantId}:${event.aggregateId}`,
        ttlMs: 30_000,
      },
    },
    handle: async (event, context) => {
      const projectId = context.tenantId;

      // Guard: skip old evaluations (resyncing).
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;

      const triggers =
        await deps.triggers.getActiveTraceTriggersForProject(projectId);
      const candidates = triggers.filter((t) => triggerReadsEvaluations(t));
      if (candidates.length === 0) return;

      const brandedTenantId = createTenantId(projectId);
      const evalRun = await deps.evaluationRunStore.get(context.aggregateId, {
        tenantId: brandedTenantId,
        aggregateId: context.aggregateId,
      });
      if (!evalRun) return;
      if (
        evalRun.status !== "processed" &&
        evalRun.status !== "error" &&
        evalRun.status !== "skipped"
      ) {
        return;
      }
      if (!evalRun.traceId) return;
      const traceId = evalRun.traceId;

      // Existence guard only: dispatch re-reads the fold at fire time. A
      // trace with no fold has nothing to match.
      const traceSummary = await deps.traceSummaryStore.get(traceId, {
        tenantId: brandedTenantId,
        aggregateId: traceId,
      });
      if (!traceSummary) {
        logger.debug(
          { projectId, traceId, evaluationId: evalRun.evaluationId },
          "Trace summary not found for evaluation alert trigger match",
        );
        return;
      }

      for (const trigger of candidates) {
        const view: TriggerMatchEventView = {
          traceId,
          action: trigger.action,
          actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
            ? "notify"
            : "persist",
          traceDebounceMs: trigger.traceDebounceMs,
          notificationCadence: trigger.notificationCadence,
        };
        const result = await deps.settlement.handleEvent({
          envelope: toTriggerMatchEnvelope({
            sourceEventId: event.id,
            occurredAt: event.occurredAt,
            projectId,
            triggerId: trigger.id,
            view,
          }),
          now: clock(),
        });
        if (result.outcome === "revisionConflict") {
          throw new Error(
            `triggerSettlement revision conflict on event ${event.id} (trigger ${trigger.id}) — retry via queue redelivery`,
          );
        }
        if (result.outcome === "committed") {
          deps.notifyOutbox?.();
        }
      }
    },
  };
}
