// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { NOTIFY_TRIGGER_ACTIONS } from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { TriggerMatchRecordedEventData } from "~/server/event-sourcing/pipelines/automations/schemas/events";
import { passesTraceOriginGuards } from "~/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedSubscriber";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";

export interface RecordTriggerMatchPort {
  send(
    data: TriggerMatchRecordedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

/** Post-traceSummary, origin-guarded handoff into the automations pipeline. */
export function createTraceAlertTriggerMatchHandler(deps: {
  triggers: TriggerService;
  recordTriggerMatch: RecordTriggerMatchPort;
}) {
  return async (
    event: TraceProcessingEvent,
    context: TriggerContext<TraceSummaryData>,
  ): Promise<void> => {
    if (!passesTraceOriginGuards(event, context.state)) return;
    const triggers = await deps.triggers.getActiveTraceTriggersForProject(
      context.tenantId,
    );
    for (const trigger of triggers) {
      if (classifyTriggerFilters(trigger.filters).hasEvaluationFilters) continue;
      await deps.recordTriggerMatch.send({
        tenantId: context.tenantId,
        occurredAt: event.occurredAt,
        triggerId: trigger.id,
        traceId: context.aggregateId,
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
