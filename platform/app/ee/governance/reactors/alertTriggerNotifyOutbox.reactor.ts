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

export interface AlertTriggerNotifyOutboxReactorDeps {
  triggers: TriggerService;
}

/**
 * NOTIFY-class branch of the trace-pipeline alert trigger reactor,
 * registered via `.withOutbox` (ADR-030). For every active trace-only
 * trigger whose action is NOTIFY (SEND_EMAIL / SEND_SLACK_MESSAGE),
 * emits an `OutboxEnqueueRequest` whose payload is a settle-stage job;
 * the framework adapter forwards it to `outbox.enqueueSettle`, the
 * settle dispatcher re-reads the fold after `traceDebounceMs`, and
 * cadence dispatches the digest.
 *
 * Triggers with evaluation filters are handled by
 * `evaluationAlertTriggerNotifyOutbox.reactor.ts` on the evaluation
 * pipeline. Persist-class actions (ADD_TO_DATASET, etc.) ride the same
 * settle/cadence outbox via `alertTrigger.reactor.ts` (ADR-035), stamped
 * `actionClass: "persist"`; this reactor only emits the notify class.
 */
export function createAlertTriggerNotifyOutboxReactor(
  deps: AlertTriggerNotifyOutboxReactorDeps,
): OutboxReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return defineOriginGuardedTraceOutboxReactor({
    name: "alertTriggerNotifyOutbox",
    jobIdPrefix: "alert-trigger-notify-outbox",
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
        // pipeline; this reactor only owns trace-only triggers.
        if (hasEvaluationFilters) continue;
        if (!NOTIFY_TRIGGER_ACTIONS.has(trigger.action)) continue;

        const payload: SettleStagePayload = {
          stage: "settle",
          projectId: tenantId,
          triggerId: trigger.id,
          traceId,
          reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
          actionClass: "notify",
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
