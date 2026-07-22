import type { TriggerFilters } from "@langwatch/automations/domain/filters";
import type { TriggerSummary } from "@langwatch/automations/repositories/trigger.repository";

/** What the settle re-check reads off the settled fold. */
export interface SettledFoldSlice {
  occurredAt: number;
  spanCount: number;
}

/**
 * The app's filter-evaluation machinery, injected whole (method syntax on
 * purpose — bivariance lets the app's stricter signatures satisfy these).
 * The fold, evaluation, event, and precondition-data types flow through
 * opaquely: this module orders the checks and owns the fail-closed contract;
 * the kit owns what the data means.
 */
export interface SettledMatchFilterKit<TFold, TEvals, TEvents, TData> {
  queryNeeds(filterQuery: string): ReadonlySet<string>;
  evaluateQueryInMemory(
    filterQuery: string,
    data: {
      summary: TFold;
      evaluations: TEvals | null;
      events: TEvents | null;
      spans: null;
    },
  ): boolean;
  classifyTriggerFilters(filters: TriggerFilters): {
    traceFilters: TriggerFilters;
    evaluationFilters: TriggerFilters;
    hasEvaluationFilters: boolean;
  };
  triggerFiltersReferenceEvents(filters: TriggerFilters): boolean;
  buildPreconditionTraceDataFromFoldState(
    foldState: TFold,
    events: TEvents | null,
  ): TData;
  matchesTriggerFilters(traceData: TData, filters: TriggerFilters): boolean;
  matchesEvaluationFilters(
    evaluations: TEvals,
    filters: TriggerFilters,
  ): boolean;
}

export interface ConfirmSettledMatchDeps<
  TFold extends SettledFoldSlice = SettledFoldSlice,
  TEvals = unknown,
  TEvents = unknown,
  TData = unknown,
> {
  evaluationRuns: {
    findByTraceId(projectId: string, traceId: string): Promise<TEvals>;
  };
  deriveEvents: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }) => Promise<TEvents>;
  filters: SettledMatchFilterKit<TFold, TEvals, TEvents, TData>;
}

/**
 * The dispatch-time filter re-check (ADR-026 settle semantics): a match
 * detected at event time is only dispatched if the trigger's filters still
 * pass against the SETTLED fold state. ADR-043 trace-subject automations
 * carry a liqe `filterQuery` matched in-memory; legacy triggers keep the
 * structured `filters` path. Anything unevaluable at dispatch fails closed.
 */
export async function confirmSettledMatch<
  TFold extends SettledFoldSlice,
  TEvals,
  TEvents,
  TData,
>({
  deps,
  trigger,
  projectId,
  traceId,
  foldState,
}: {
  deps: ConfirmSettledMatchDeps<TFold, TEvals, TEvents, TData>;
  trigger: TriggerSummary;
  projectId: string;
  traceId: string;
  foldState: TFold;
}): Promise<boolean> {
  if (trigger.filterQuery != null) {
    const needs = deps.filters.queryNeeds(trigger.filterQuery);
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
    return deps.filters.evaluateQueryInMemory(trigger.filterQuery, {
      summary: foldState,
      evaluations,
      events,
      spans: null,
    });
  }

  const { traceFilters, evaluationFilters, hasEvaluationFilters } =
    deps.filters.classifyTriggerFilters(trigger.filters);

  const events = deps.filters.triggerFiltersReferenceEvents(traceFilters)
    ? await deps.deriveEvents({
        tenantId: projectId,
        traceId,
        occurredAtMs: foldState.occurredAt,
        foldVersion: foldState.spanCount,
      })
    : null;
  const traceData = deps.filters.buildPreconditionTraceDataFromFoldState(foldState, events);

  if (
    Object.keys(traceFilters).length > 0 &&
    !deps.filters.matchesTriggerFilters(traceData, traceFilters)
  ) {
    return false;
  }

  if (hasEvaluationFilters) {
    const allEvaluations = await deps.evaluationRuns.findByTraceId(
      projectId,
      traceId,
    );
    if (!deps.filters.matchesEvaluationFilters(allEvaluations, evaluationFilters)) {
      return false;
    }
  }

  return true;
}
