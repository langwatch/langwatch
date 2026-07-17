import { createLogger } from "@langwatch/observability";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type {
  Fact,
  FeedFn,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { EvaluationProcessingEvent } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";

import {
  NOTIFY_TRIGGER_ACTIONS,
  triggerReadsEvaluations,
} from "../dispatch/triggerActionDispatch";
import type { TriggerService } from "../trigger.service";
import type { TriggerSettlementFacts } from "./triggerSettlement.process";

const logger = createLogger(
  "langwatch:triggers:evaluation-alert-trigger-match-feed",
);

/**
 * ADR-052: evaluation-side alert-trigger match detection — a
 * `{ fold: "evaluationRun" }` feed on the EVALUATION pipeline into the
 * triggerSettlement process manager (mounted on the trace pipeline).
 * Replaces the `evaluationAlertTrigger` + notify `.withOutbox` reactors.
 * Owns every active trigger whose subject reads evaluation results; the
 * at-most-once `TriggerSent` claim dedupes the two pipelines' matches at
 * dispatch.
 *
 * `ctx.state` is the committed evaluationRun fold (terminal status +
 * traceId live there — completed events carry no traceId).
 */
export function createEvaluationAlertTriggerMatchFeed(deps: {
  triggers: TriggerService;
  /** Existence guard only — dispatch re-reads the fold at fire time. */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
}): FeedFn<EvaluationProcessingEvent, TriggerSettlementFacts, EvaluationRunData> {
  return async (event, { tenantId, state: evalRun }) => {
    // Guard: skip old evaluations (resyncing).
    if (event.occurredAt < Date.now() - 60 * 60 * 1000) return [];

    if (
      evalRun.status !== "processed" &&
      evalRun.status !== "error" &&
      evalRun.status !== "skipped"
    ) {
      return [];
    }
    if (!evalRun.traceId) return [];
    const traceId = evalRun.traceId;

    const triggers =
      await deps.triggers.getActiveTraceTriggersForProject(tenantId);
    const candidates = triggers.filter((t) => triggerReadsEvaluations(t));
    if (candidates.length === 0) return [];

    // Existence guard only: a trace with no fold has nothing to match.
    const traceSummary = await deps.traceSummaryStore.get(traceId, {
      tenantId: createTenantId(tenantId),
      aggregateId: traceId,
    });
    if (!traceSummary) {
      logger.debug(
        { tenantId, traceId, evaluationId: evalRun.evaluationId },
        "Trace summary not found for evaluation alert trigger match",
      );
      return [];
    }

    const facts: Array<Fact<TriggerSettlementFacts>> = [];
    for (const trigger of candidates) {
      facts.push({
        key: trigger.id,
        fact: "trigger-match",
        data: {
          traceId,
          action: trigger.action,
          actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
            ? "notify"
            : "persist",
          traceDebounceMs: trigger.traceDebounceMs,
          notificationCadence: trigger.notificationCadence,
        },
      });
    }
    return facts;
  };
}
