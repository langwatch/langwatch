// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { NOTIFY_TRIGGER_ACTIONS } from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { RecordTriggerMatchPort } from "~/server/event-sourcing/pipelines/automations/subscribers/evaluationAlertTriggerMatch.subscriber";
import { passesTraceOriginGuards } from "~/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedReactor";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";

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
    // Events already committed with an empty aggregateId (see the traceId
    // guard in originGate.reactor) would fail recordTriggerMatch validation
    // and poison the reactor job. There is no trace to match a trigger
    // against, so skip rather than throw.
    if (!context.aggregateId) return;
    const triggers = await deps.triggers.getActiveTraceTriggersForProject(
      context.tenantId,
    );
    for (const trigger of triggers) {
      if (classifyTriggerFilters(trigger.filters).hasEvaluationFilters) continue;
      // Idempotency contract (at-least-once delivery): every input to the
      // command's idempotency key — triggerId, traceId, and the settle-window
      // bucket derived from occurredAt + traceDebounceMs — comes from the
      // committed event or trigger config, never wall-clock at handling time.
      // A redelivered event therefore re-sends byte-identical commands whose
      // events collapse on idempotencyKey in the store.
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
