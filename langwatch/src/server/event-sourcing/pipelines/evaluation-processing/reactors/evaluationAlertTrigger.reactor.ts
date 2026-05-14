import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesEvaluationFilters,
  matchesTriggerFilters,
} from "~/server/filters/triggerFilter.matcher";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import { createTenantId } from "../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { EvaluationProcessingEvent } from "../schemas/events";
import {
  isEvaluationCompletedEvent,
  isEvaluationReportedEvent,
} from "../schemas/typeGuards";
import {
  dispatchTriggerAction,
  type TriggerActionDispatchDeps,
} from "../../shared/triggerActionDispatch";

const logger = createLogger(
  "langwatch:evaluation-processing:evaluation-alert-trigger-reactor",
);

export interface EvaluationAlertTriggerReactorDeps
  extends TriggerActionDispatchDeps {
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  evaluationRuns: EvaluationRunService;
}

/**
 * Evaluates user-defined triggers that include evaluation filters.
 *
 * Fires on the evaluation-processing pipeline after an evaluation completes.
 * For each active trigger with evaluation filters:
 *   1. Cross-reads the trace fold state to check trace-level filters
 *   2. Loads all completed evaluations for the trace
 *   3. Matches evaluation filters against the full set of evaluations
 *   4. Dispatches the configured action if all filters pass
 *
 * This complements the alertTrigger reactor on the trace pipeline, which
 * handles triggers with only trace-level filters.
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

      // Filter to triggers that have evaluation filters
      const triggersWithEvalFilters = triggers.filter((t) => {
        const { hasEvaluationFilters } = classifyTriggerFilters(t.filters);
        return hasEvaluationFilters;
      });
      if (triggersWithEvalFilters.length === 0) return;

      // Cross-pipeline read: get the trace fold state
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

      // Load all evaluations for this trace
      const allEvaluations = await deps.evaluationRuns.findByTraceId(
        tenantId,
        traceId,
      );

      const traceData = buildPreconditionTraceDataFromFoldState(traceSummary);

      for (const trigger of triggersWithEvalFilters) {
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
          logger.error(
            {
              tenantId,
              traceId,
              triggerId: trigger.id,
              evaluationId: evalRun.evaluationId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to evaluate trigger on evaluation completion",
          );
          captureException(error, {
            extra: {
              tenantId,
              traceId,
              triggerId: trigger.id,
              evaluationId: evalRun.evaluationId,
              triggerAction: trigger.action,
            },
          });
        }
      }
    },
  };
}
