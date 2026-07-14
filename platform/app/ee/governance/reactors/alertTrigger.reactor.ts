// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import type {
  OutboxEnqueueRequest,
  OutboxReactorDefinition,
} from "~/server/event-sourcing/outbox/outboxReactor.types";
import {
  auditDedupKey,
  cadenceGroupKey,
  type SettleStagePayload,
  TRIGGER_NOTIFY_REACTOR_NAME,
} from "~/server/event-sourcing/outbox/payload";
import { NOTIFY_TRIGGER_ACTIONS } from "~/server/event-sourcing/pipelines/shared/triggerActionDispatch";
import { defineOriginGuardedTraceOutboxReactor } from "~/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedReactor";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";

export interface AlertTriggerReactorDeps {
  triggers: TriggerService;
}

/**
 * Persist-class branch of the trace-pipeline alert trigger reactor,
 * registered via `.withOutbox` (ADR-030 + ADR-035).
 *
 * Fires on every trace event (via the traceSummary fold). For each
 * active trace-only trigger whose action is PERSIST (dataset write,
 * annotation-queue add), emits an `OutboxEnqueueRequest` whose payload
 * is a settle-stage job stamped `actionClass: "persist"`. The settle
 * dispatcher re-reads the fold after `traceDebounceMs`, re-runs the
 * trace filters against the now-settled state, and (on match)
 * re-enqueues an immediate cadence that claims `TriggerSent` and runs
 * `dispatchTriggerAction`.
 *
 * Before ADR-035 this reactor dispatched persist actions inline against
 * the (possibly half-formed) fold. It now rides the same settle/cadence
 * outbox as notify so `traceDebounceMs` (ADR-026) applies before the
 * claim and the side effect — the dataset row no longer diverges from
 * the trace the operator browses later.
 *
 * NOTIFY-class actions (email / Slack) are owned by
 * `alertTriggerNotifyOutbox.reactor.ts`; triggers with evaluation
 * filters are owned by the evaluation pipeline reactors and skipped
 * here. Pre-filtering to persist-class trace-only triggers keeps this
 * reactor's `decide()` from emitting payloads the dispatcher would
 * route elsewhere.
 */
export function createAlertTriggerReactor(
  deps: AlertTriggerReactorDeps,
): OutboxReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return defineOriginGuardedTraceOutboxReactor({
    name: "alertTrigger",
    jobIdPrefix: "alert-trigger",
    async decide(_event, context) {
      const { tenantId, aggregateId: traceId, foldState } = context;

      const triggers =
        await deps.triggers.getActiveTraceTriggersForProject(tenantId);
      if (triggers.length === 0) return [];

      const requests: OutboxEnqueueRequest[] = [];
      for (const trigger of triggers) {
        const { hasEvaluationFilters } = classifyTriggerFilters(
          trigger.filters,
        );
        // Triggers with evaluation filters fire from the evaluation
        // pipeline; this reactor only owns trace-only triggers. NOTIFY
        // actions ride the notify reactor — this branch is persist-only.
        if (hasEvaluationFilters) continue;
        if (NOTIFY_TRIGGER_ACTIONS.has(trigger.action)) continue;

        const payload: SettleStagePayload = {
          stage: "settle",
          projectId: tenantId,
          triggerId: trigger.id,
          traceId,
          reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
          actionClass: "persist",
          auditDedupKey: auditDedupKey({
            projectId: tenantId,
            triggerId: trigger.id,
            traceId,
          }),
          foldSnapshotAtEnqueue: {
            computedInput: foldState.computedInput ?? "",
            computedOutput: foldState.computedOutput ?? "",
          },
        };
        requests.push({
          dedupKey: payload.auditDedupKey,
          groupKey: cadenceGroupKey({
            projectId: tenantId,
            triggerId: trigger.id,
          }),
          // SettleStagePayload is a Prisma-JSON-compatible object shape;
          // the cast crosses the structural-vs-nominal gap between our
          // `stage: "settle"` literal type and `Prisma.InputJsonValue`.
          payload: payload as unknown as OutboxEnqueueRequest["payload"],
          enqueueOptions: { ttlMs: trigger.traceDebounceMs },
        });
      }
      return requests;
    },
  });
}
