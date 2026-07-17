import { createLogger } from "@langwatch/observability";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import { createTenantId } from "../../../domain/tenantId";
import type {
  OutboxEnqueueRequest,
  OutboxReactorDefinition,
} from "../../../outbox/outboxReactor.types";
import {
  auditDedupKey,
  cadenceGroupKey,
  type SettleStagePayload,
  TRIGGER_NOTIFY_REACTOR_NAME,
} from "../../../outbox/payload";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ReactorContext } from "../../../reactors/reactor.types";
import {
  NOTIFY_TRIGGER_ACTIONS,
  triggerReadsEvaluations,
} from "../../../../app-layer/triggers/dispatch/triggerActionDispatch";
import type { EvaluationProcessingEvent } from "../schemas/events";
import {
  isEvaluationCompletedEvent,
  isEvaluationReportedEvent,
} from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:evaluation-processing:eval-alert-trigger-notify-outbox-reactor",
);

export interface EvaluationAlertTriggerNotifyOutboxReactorDeps {
  triggers: TriggerService;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
}

/**
 * NOTIFY-class branch of the evaluation-pipeline alert trigger reactor,
 * registered via `.withOutbox`. Fires on terminal evaluation events; for
 * every active trigger with evaluation filters whose action is NOTIFY,
 * emits an `OutboxEnqueueRequest` with a settle-stage payload. The
 * settle dispatcher re-reads BOTH the trace fold AND the evaluation
 * results after `traceDebounceMs`, so we deliberately skip the
 * expensive cross-pipeline evaluation load + events derivation here.
 *
 * Persist-class actions (ADD_TO_DATASET, etc.) ride the same
 * settle/cadence outbox via `evaluationAlertTrigger.reactor.ts`
 * (ADR-035), stamped `actionClass: "persist"`; this reactor only emits
 * the notify class.
 */
export function createEvaluationAlertTriggerNotifyOutboxReactor(
  deps: EvaluationAlertTriggerNotifyOutboxReactorDeps,
): OutboxReactorDefinition<EvaluationProcessingEvent, EvaluationRunData> {
  return {
    name: "evaluationAlertTriggerNotifyOutbox",
    options: {
      makeJobId: (payload) =>
        `eval-alert-trigger-notify-outbox:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 30_000,
      delay: 10_000,
    },

    async decide(
      event: EvaluationProcessingEvent,
      context: ReactorContext<EvaluationRunData>,
    ): Promise<OutboxEnqueueRequest[]> {
      if (
        !isEvaluationCompletedEvent(event) &&
        !isEvaluationReportedEvent(event)
      ) {
        return [];
      }

      const { tenantId, foldState: evalRun } = context;

      if (
        evalRun.status !== "processed" &&
        evalRun.status !== "error" &&
        evalRun.status !== "skipped"
      ) {
        return [];
      }

      if (!evalRun.traceId) return [];
      const traceId = evalRun.traceId;

      // Guard: skip old evaluations (resyncing).
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) return [];

      const triggers =
        await deps.triggers.getActiveTraceTriggersForProject(tenantId);
      if (triggers.length === 0) return [];

      const candidates = triggers.filter(
        (t) => triggerReadsEvaluations(t) && NOTIFY_TRIGGER_ACTIONS.has(t.action),
      );
      if (candidates.length === 0) return [];

      // Existence guard only: settle re-reads the fold at fire time, so nothing
      // from the summary is carried on the payload. A trace with no fold has
      // nothing to match, so there is no payload to enqueue.
      const brandedTenantId = createTenantId(tenantId);
      const traceSummary = await deps.traceSummaryStore.get(traceId, {
        tenantId: brandedTenantId,
        aggregateId: traceId,
      });
      if (!traceSummary) {
        logger.debug(
          { tenantId, traceId, evaluationId: evalRun.evaluationId },
          "Trace summary not found for evaluation alert trigger notify outbox",
        );
        return [];
      }

      const requests: OutboxEnqueueRequest[] = [];
      for (const trigger of candidates) {
        const payload: SettleStagePayload = {
          stage: "settle",
          // reactor-001: stamp actionClass so the dispatcher routes without
          // falling back to reading trigger.action; the trace pair + the
          // eval persist reactor all set this — this one was missing.
          actionClass: "notify",
          projectId: tenantId,
          triggerId: trigger.id,
          traceId,
          reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
          auditDedupKey: auditDedupKey({
            projectId: tenantId,
            triggerId: trigger.id,
            traceId,
          }),
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
  };
}
