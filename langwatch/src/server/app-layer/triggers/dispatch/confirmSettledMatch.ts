import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import {
  evaluateQueryInMemory,
  queryNeeds,
} from "~/server/app-layer/traces/filter-to-clickhouse";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesEvaluationFilters,
  matchesTriggerFilters,
  triggerFiltersReferenceEvents,
} from "~/server/filters/triggerFilter.matcher";

export interface ConfirmSettledMatchDeps {
  evaluationRuns: EvaluationRunService;
  deriveEvents: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }) => Promise<DerivedTraceEvent[]>;
}

/**
 * The dispatch-time filter re-check (ADR-026 settle semantics): a match
 * detected at event time is only dispatched if the trigger's filters still
 * pass against the SETTLED fold state. ADR-043 trace-subject automations
 * carry a liqe `filterQuery` matched in-memory; legacy triggers keep the
 * structured `filters` path. Anything unevaluable at dispatch fails closed.
 */
export async function confirmSettledMatch({
  deps,
  trigger,
  projectId,
  traceId,
  foldState,
}: {
  deps: ConfirmSettledMatchDeps;
  trigger: TriggerSummary;
  projectId: string;
  traceId: string;
  foldState: TraceSummaryData;
}): Promise<boolean> {
  if (trigger.filterQuery != null) {
    const needs = queryNeeds(trigger.filterQuery);
    const evaluations = needs.has("evaluations")
      ? await deps.evaluationRuns.findByTraceId(projectId, traceId)
      : null;
    const events = needs.has("events")
      ? await deps.deriveEvents({
          tenantId: projectId,
          traceId,
          occurredAtMs: foldState.occurredAt,
          foldVersion: foldState.spanCount,
        })
      : null;
    // Spans aren't derived at dispatch time; the evaluator fails span-scoped
    // fields closed on its own, so `spans` stays null.
    return evaluateQueryInMemory(trigger.filterQuery, {
      summary: foldState,
      evaluations,
      events,
      spans: null,
    });
  }

  const { traceFilters, evaluationFilters, hasEvaluationFilters } =
    classifyTriggerFilters(trigger.filters);

  const events = triggerFiltersReferenceEvents(traceFilters)
    ? await deps.deriveEvents({
        tenantId: projectId,
        traceId,
        occurredAtMs: foldState.occurredAt,
        foldVersion: foldState.spanCount,
      })
    : null;
  const traceData = buildPreconditionTraceDataFromFoldState(foldState, events);

  if (
    Object.keys(traceFilters).length > 0 &&
    !matchesTriggerFilters(traceData, traceFilters)
  ) {
    return false;
  }

  if (hasEvaluationFilters) {
    const allEvaluations = await deps.evaluationRuns.findByTraceId(
      projectId,
      traceId,
    );
    if (!matchesEvaluationFilters(allEvaluations, evaluationFilters)) {
      return false;
    }
  }

  return true;
}
