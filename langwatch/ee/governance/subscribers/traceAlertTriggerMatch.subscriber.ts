// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { toTriggerMatchEnvelope } from "~/server/app-layer/triggers/process-manager/triggerSettlementProcess.definition";
import type { TriggerMatchEventView } from "~/server/app-layer/triggers/process-manager/triggerSettlementProcess.types";
import { NOTIFY_TRIGGER_ACTIONS } from "~/server/app-layer/triggers/dispatch/triggerActionDispatch";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import type { TriggerSettlementProcessPort } from "~/server/app-layer/triggers/subscribers/types";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { passesTraceOriginGuards } from "~/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedReactor";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";

export interface TraceAlertTriggerMatchSubscriberDeps {
  triggers: TriggerService;
  /** For the origin guards the fold-attached reactors got for free. */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  settlement: TriggerSettlementProcessPort;
  /** Best-effort latency nudge; Postgres polling remains the recovery path. */
  notifyOutbox?: () => void;
  clock?: () => number;
}

/**
 * ADR-052: trace-side alert-trigger match detection as an event subscriber —
 * replaces the `alertTrigger` (persist) and `alertTriggerNotifyOutbox`
 * (notify) `.withOutbox` reactors in one pass over the active triggers.
 *
 * The subscriber sees the committed event only; the origin guards that used
 * to read the reactor's fold snapshot now read the traceSummary store. The
 * 30s delay + per-trace debounce below (the same window the reactor jobs
 * had) gives the fold time to converge, and the dispatch handler re-confirms
 * every match against the settled fold regardless — a racing read can only
 * produce a false candidate that dispatch drops.
 *
 * Triggers whose subject reads evaluations fire from the evaluation-pipeline
 * subscriber instead.
 */
export function createTraceAlertTriggerMatchSubscriber(
  deps: TraceAlertTriggerMatchSubscriberDeps,
): EventSubscriberDefinition<TraceProcessingEvent> {
  const clock = deps.clock ?? (() => Date.now());
  return {
    name: "traceAlertTriggerMatch",
    // Only genuine message events re-run match detection — derived
    // enrichment events (topic_assigned etc.) never fan out to automations
    // (the 2026-05-27 read-amp incident guard, now an eventTypes filter).
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
    options: {
      delay: 30_000,
      deduplication: {
        makeId: (event) =>
          `trace-alert-trigger-match:${event.tenantId}:${event.aggregateId}`,
        ttlMs: 30_000,
      },
    },
    handle: async (event, context) => {
      const projectId = context.tenantId;
      const traceId = context.aggregateId;

      const triggers =
        await deps.triggers.getActiveTraceTriggersForProject(projectId);
      if (triggers.length === 0) return;

      const foldState = await deps.traceSummaryStore.get(traceId, {
        tenantId: createTenantId(projectId),
        aggregateId: traceId,
      });
      // No fold yet (still converging, or the trace is gone): nothing to
      // guard against or match. A later message event re-enters here.
      if (!foldState) return;
      if (!passesTraceOriginGuards(event, foldState)) return;

      for (const trigger of triggers) {
        const { hasEvaluationFilters } = classifyTriggerFilters(
          trigger.filters,
        );
        // Evaluation-filtered triggers fire from the evaluation pipeline.
        if (hasEvaluationFilters) continue;

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
