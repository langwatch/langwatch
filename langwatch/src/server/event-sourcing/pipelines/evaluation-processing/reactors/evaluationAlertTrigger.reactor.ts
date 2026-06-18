import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesEvaluationFilters,
  matchesTriggerFilters,
  triggerFiltersReferenceEvents,
} from "~/server/filters/triggerFilter.matcher";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { createTenantId } from "../../../domain/tenantId";
import { isDispatchError } from "../../../outbox/dispatchError";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import {
  dispatchTriggerAction,
  NOTIFY_TRIGGER_ACTIONS,
  type TriggerActionDispatchDeps,
} from "../../shared/triggerActionDispatch";
import type { EvaluationProcessingEvent } from "../schemas/events";
import {
  isEvaluationCompletedEvent,
  isEvaluationReportedEvent,
} from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:evaluation-processing:evaluation-alert-trigger-reactor",
);

export interface EvaluationAlertTriggerReactorDeps
  extends TriggerActionDispatchDeps {
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  evaluationRuns: EvaluationRunService;
  /**
   * Derives the trace-level events list from stored_spans. Only invoked when a
   * trigger actually filters on event fields, so the common path pays nothing.
   */
  deriveEvents: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }) => Promise<DerivedTraceEvent[]>;
}

/**
 * Persist-class branch of the evaluation-pipeline alert trigger reactor.
 *
 * Fires after a terminal evaluation event. For triggers with evaluation
 * filters whose action is PERSIST (dataset write, annotation queue add),
 * cross-reads the trace fold, loads all evaluations for the trace,
 * matches both filter halves, claims `TriggerSent`, and dispatches
 * inline. NOTIFY-class triggers with evaluation filters are owned by
 * `evaluationAlertTriggerNotifyOutbox.reactor.ts`, registered via
 * `.withOutbox` so dispatch flows through the settle/cadence outbox.
 */
export function createEvaluationAlertTriggerReactor(
  deps: EvaluationAlertTriggerReactorDeps,
): ReactorDefinition<EvaluationProcessingEvent, EvaluationRunData> {
  return {
    name: "evaluationAlertTrigger",
    options: {
      makeJobId: (payload) =>
        `eval-alert-trigger:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 30_000,
      delay: 10_000,
    },

    async handle(
      event: EvaluationProcessingEvent,
      context: ReactorContext<EvaluationRunData>,
    ): Promise<void> {
      // Only fire on terminal evaluation events
      if (
        !isEvaluationCompletedEvent(event) &&
        !isEvaluationReportedEvent(event)
      ) {
        return;
      }

      const { tenantId, foldState: evalRun } = context;

      // Guard: skip non-terminal statuses (fold may still be in_progress)
      if (
        evalRun.status !== "processed" &&
        evalRun.status !== "error" &&
        evalRun.status !== "skipped"
      ) {
        return;
      }

      // Guard: must have a traceId to check trace filters and dispatch actions
      if (!evalRun.traceId) return;

      const traceId = evalRun.traceId;

      // Guard: skip old evaluations (resyncing)
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;

      const triggers =
        await deps.triggers.getActiveTraceTriggersForProject(tenantId);
      if (triggers.length === 0) return;

      // Restrict to persist-class triggers with evaluation filters.
      // NOTIFY-class triggers with evaluation filters are owned by
      // `evaluationAlertTriggerNotifyOutbox.reactor.ts`. Pre-filtering
      // here also skips the expensive cross-pipeline fold + evaluation
      // load + events derivation when the only matching triggers are
      // notify-class.
      const inlineBound = triggers.filter((t) => {
        const { hasEvaluationFilters } = classifyTriggerFilters(t.filters);
        return hasEvaluationFilters && !NOTIFY_TRIGGER_ACTIONS.has(t.action);
      });
      if (inlineBound.length === 0) return;

      // Cross-pipeline read: get the trace fold state.
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
        return;
      }

      // Load all evaluations for this trace (inline path only)
      const allEvaluations = await deps.evaluationRuns.findByTraceId(
        tenantId,
        traceId,
      );

      // Derive the trace-level events list only if one of these triggers filters
      // on event fields (the trace-level half of its filter set).
      const needsEvents = inlineBound.some((t) =>
        triggerFiltersReferenceEvents(classifyTriggerFilters(t.filters).traceFilters),
      );
      const events = needsEvents
        ? await deps.deriveEvents({
            tenantId,
            traceId,
            occurredAtMs: traceSummary.occurredAt,
            foldVersion: traceSummary.spanCount,
          })
        : null;

      const traceData = buildPreconditionTraceDataFromFoldState(
        traceSummary,
        events,
      );

      for (const trigger of inlineBound) {
        try {
          const { traceFilters, evaluationFilters } =
            classifyTriggerFilters(trigger.filters);

          // Check trace-level filters first (cheaper)
          if (
            Object.keys(traceFilters).length > 0 &&
            !matchesTriggerFilters(traceData, traceFilters)
          ) {
            continue;
          }

          // Check evaluation filters against all evaluations for this trace
          if (!matchesEvaluationFilters(allEvaluations, evaluationFilters)) {
            continue;
          }

          // Atomic claim: see alertTrigger.reactor.ts for rationale.
          const claimed = await deps.triggers.claimSend({
            triggerId: trigger.id,
            traceId,
            projectId: tenantId,
          });
          if (!claimed) continue;

          await dispatchTriggerAction({
            deps,
            trigger,
            traceId,
            tenantId,
            foldState: traceSummary,
          });
        } catch (error) {
          // A failed dispatch now throws (DispatchError) rather than being
          // swallowed; surface its retryable classification for operators. The
          // claim already landed, so the in-line path does not retry — the
          // outbox migration is what adds durable retry.
          const retryable = isDispatchError(error)
            ? error.retryable
            : undefined;
          logger.error(
            {
              tenantId,
              traceId,
              triggerId: trigger.id,
              evaluationId: evalRun.evaluationId,
              retryable,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to evaluate trigger on evaluation completion",
          );
          captureException(toError(error), {
            extra: {
              tenantId,
              traceId,
              triggerId: trigger.id,
              evaluationId: evalRun.evaluationId,
              triggerAction: trigger.action,
              retryable,
            },
          });
        }
      }
    },
  };
}
