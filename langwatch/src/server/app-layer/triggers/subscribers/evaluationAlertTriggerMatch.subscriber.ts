import { createLogger } from "@langwatch/observability";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { RecordTriggerMatchPort } from "@ee/governance/subscribers/traceAlertTriggerMatch.subscriber";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { EvaluationProcessingEvent } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";

import {
  NOTIFY_TRIGGER_ACTIONS,
  triggerReadsEvaluations,
} from "../dispatch/triggerActionDispatch";
import type { TriggerService } from "../trigger.service";

const logger = createLogger(
  "langwatch:triggers:evaluation-alert-trigger-match-subscriber",
);

export function createEvaluationAlertTriggerMatchHandler(deps: {
  triggers: TriggerService;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  recordTriggerMatch: RecordTriggerMatchPort;
}) {
  return async (
    event: EvaluationProcessingEvent,
    context: TriggerContext<EvaluationRunData>,
  ): Promise<void> => {
    if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;
    const evaluation = context.state;
    if (
      evaluation.status !== "processed" &&
      evaluation.status !== "error" &&
      evaluation.status !== "skipped"
    ) {
      return;
    }
    if (!evaluation.traceId) return;
    const traceId = evaluation.traceId;
    const traceSummary = await deps.traceSummaryStore.get(traceId, {
      tenantId: createTenantId(context.tenantId),
      aggregateId: traceId,
    });
    if (!traceSummary) {
      logger.debug(
        { tenantId: context.tenantId, traceId },
        "Trace summary not found for evaluation automation match",
      );
      return;
    }
    const triggers = await deps.triggers.getActiveTraceTriggersForProject(
      context.tenantId,
    );
    for (const trigger of triggers.filter(triggerReadsEvaluations)) {
      await deps.recordTriggerMatch.send({
        tenantId: context.tenantId,
        occurredAt: event.occurredAt,
        triggerId: trigger.id,
        traceId,
        action: trigger.action,
        actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
          ? "notify"
          : "persist",
        traceDebounceMs: trigger.traceDebounceMs,
        notificationCadence: trigger.notificationCadence,
      });
    }
  };
}
