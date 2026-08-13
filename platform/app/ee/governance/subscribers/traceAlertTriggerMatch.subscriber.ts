// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { NOTIFY_TRIGGER_ACTIONS } from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { RecordTriggerMatchPort } from "~/server/event-sourcing/pipelines/automations/subscribers/evaluationAlertTriggerMatch.subscriber";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { passesTraceOriginGuards } from "~/server/event-sourcing/pipelines/trace-processing/subscribers/_originGuardedSubscriber";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";
import { incrementAutomationMatchRecordsTotal } from "~/server/metrics";

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
    let recorded = 0;
    for (const trigger of triggers) {
      if (classifyTriggerFilters(trigger.filters).hasEvaluationFilters)
        continue;
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
      recorded++;
    }
    // A match is recorded for every active trigger on every trace, before any
    // filter runs. That fan-out is OUR amplification, not the customer's, so
    // it is measured for the team and NEVER capped: the daily ceiling lives at
    // dispatch, where a match has been confirmed and is about to create
    // something the customer asked for. Throttling here would charge customers
    // for a pipeline shape they did not choose.
    incrementAutomationMatchRecordsTotal(recorded);
  };
}
