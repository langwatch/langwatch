import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";
import { createLogger } from "~/utils/logger/server";
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
import { NOTIFY_TRIGGER_ACTIONS } from "../../shared/triggerActionDispatch";
import type { EvaluationProcessingEvent } from "../schemas/events";
import {
  isEvaluationCompletedEvent,
  isEvaluationReportedEvent,
} from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:evaluation-processing:evaluation-alert-trigger-reactor",
);

export interface EvaluationAlertTriggerReactorDeps {
  triggers: TriggerService;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
}

/**
 * Persist-class branch of the evaluation-pipeline alert trigger reactor,
 * registered via `.withOutbox` (ADR-030 + ADR-035).
 *
 * Fires after a terminal evaluation event. For every active trigger
 * with evaluation filters whose action is PERSIST (dataset write,
 * annotation-queue add), emits an `OutboxEnqueueRequest` with a
 * settle-stage payload stamped `actionClass: "persist"`. The settle
 * dispatcher re-reads BOTH the trace fold AND the evaluation results
 * after `traceDebounceMs`, matches both filter halves, and (on match)
 * re-enqueues an immediate cadence that claims `TriggerSent` and runs
 * `dispatchTriggerAction`.
 *
 * Before ADR-035 this reactor dispatched persist actions inline against
 * the (possibly half-formed) fold. It now rides the same settle/cadence
 * outbox as the notify class, so the expensive cross-pipeline evaluation
 * load + events derivation is deferred to the settle dispatcher and
 * skipped here.
 *
 * NOTIFY-class triggers with evaluation filters are owned by
 * `evaluationAlertTriggerNotifyOutbox.reactor.ts`; this reactor only
 * emits the persist class.
 */
export function createEvaluationAlertTriggerReactor(
  deps: EvaluationAlertTriggerReactorDeps,
): OutboxReactorDefinition<EvaluationProcessingEvent, EvaluationRunData> {
  return {
    name: "evaluationAlertTrigger",
    options: {
      makeJobId: (payload) =>
        `eval-alert-trigger:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 30_000,
      delay: 10_000,
    },

    async decide(
      event: EvaluationProcessingEvent,
      context: ReactorContext<EvaluationRunData>,
    ): Promise<OutboxEnqueueRequest[]> {
      // Only fire on terminal evaluation events
      if (
        !isEvaluationCompletedEvent(event) &&
        !isEvaluationReportedEvent(event)
      ) {
        return [];
      }

      const { tenantId, foldState: evalRun } = context;

      // Guard: skip non-terminal statuses (fold may still be in_progress)
      if (
        evalRun.status !== "processed" &&
        evalRun.status !== "error" &&
        evalRun.status !== "skipped"
      ) {
        return [];
      }

      // Guard: must have a traceId to check trace filters and dispatch actions
      if (!evalRun.traceId) return [];

      const traceId = evalRun.traceId;

      // Guard: skip old evaluations (resyncing)
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) return [];

      const triggers =
        await deps.triggers.getActiveTraceTriggersForProject(tenantId);
      if (triggers.length === 0) return [];

      // Restrict to persist-class triggers with evaluation filters.
      // NOTIFY-class triggers with evaluation filters are owned by
      // `evaluationAlertTriggerNotifyOutbox.reactor.ts`. Pre-filtering
      // here skips the cross-pipeline fold read when the only matching
      // triggers are notify-class.
      const candidates = triggers.filter((t) => {
        const { hasEvaluationFilters } = classifyTriggerFilters(t.filters);
        return hasEvaluationFilters && !NOTIFY_TRIGGER_ACTIONS.has(t.action);
      });
      if (candidates.length === 0) return [];

      // Cross-pipeline read: settle re-reads the fold itself, but we
      // need foldSnapshotAtEnqueue for the debugging breadcrumb. A
      // missing fold short-circuits — no payload to enqueue.
      const brandedTenantId = createTenantId(tenantId);
      const traceSummary = await deps.traceSummaryStore.get(traceId, {
        tenantId: brandedTenantId,
        aggregateId: traceId,
      });
      if (!traceSummary) {
        logger.debug(
          { tenantId, traceId, evaluationId: evalRun.evaluationId },
          "Trace summary not found for evaluation alert trigger",
        );
        return [];
      }

      const requests: OutboxEnqueueRequest[] = [];
      for (const trigger of candidates) {
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
            computedInput: traceSummary.computedInput ?? "",
            computedOutput: traceSummary.computedOutput ?? "",
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
  };
}
