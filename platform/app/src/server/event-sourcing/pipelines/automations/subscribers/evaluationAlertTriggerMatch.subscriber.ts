import type { FoldProjectionStore, TriggerContext } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  NOTIFY_TRIGGER_ACTIONS,
  triggerReadsEvaluations,
} from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { AutomationService } from "@langwatch/automation-contract";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerMatchRecordedEventData } from "~/server/event-sourcing/pipelines/automations/schemas/events";
import type { EvaluationProcessingEvent } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events";

const logger = createLogger(
  "langwatch:automation:evaluation-alert-trigger-match-subscriber",
);

/**
 * Port for handing a matched trigger off into the automations pipeline. Defined
 * here in the OSS automations pipeline (Apache-2.0) so the Enterprise
 * trace-alert subscriber depends inward on OSS, never the reverse. The payload
 * is a plain, license-agnostic shape with nothing EE-specific.
 */
export interface RecordTriggerMatchPort {
  send(
    data: TriggerMatchRecordedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

export function createEvaluationAlertTriggerMatchHandler(deps: {
  automation: AutomationService;
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
    const triggers = await deps.automation.getActiveTraceTriggersForProject(
      context.tenantId,
    );
    for (const trigger of triggers.filter(triggerReadsEvaluations)) {
      // Same idempotency contract as traceAlertTriggerMatch.subscriber: all
      // idempotency-key inputs (triggerId, traceId, occurredAt) derive from
      // the committed event or trigger config — never wall-clock at handling
      // time — so redelivery re-sends identical, store-deduped commands.
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
