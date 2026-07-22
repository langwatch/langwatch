import {
  triggerReadsEvaluations as packageTriggerReadsEvaluations,
  type TriggerActionDispatchDeps,
  type TriggerFilterQueryKit,
} from "@langwatch/automations-server/dispatch/trigger-action-dispatch";
import type { SettledMatchFilterKit } from "@langwatch/automations-server/dispatch/confirm-settled-match";
import type { TriggerSummary } from "@langwatch/automations/repositories/trigger.repository";
import {
  evaluateQueryInMemory,
  queryNeeds,
} from "~/server/app-layer/traces/filter-to-clickhouse";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesEvaluationFilters,
  matchesTriggerFilters,
  triggerFiltersReferenceEvents,
} from "~/server/filters/triggerFilter.matcher";
import {
  mapTraceToDatasetEntry,
  TRACE_EXPANSIONS,
  type TraceMapping,
} from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";

/** The app's filter-analysis pair for `triggerReadsEvaluations`. */
export const appTriggerFilterKit: TriggerFilterQueryKit = {
  queryNeeds,
  classifyTriggerFilters,
};

type AppEvaluations = Awaited<ReturnType<EvaluationRunService["findByTraceId"]>>;

/** The app's settle-recheck machinery, assembled once (ADR-063 §1). */
export const appSettledMatchKit: SettledMatchFilterKit<
  TraceSummaryData,
  AppEvaluations,
  DerivedTraceEvent[],
  ReturnType<typeof buildPreconditionTraceDataFromFoldState>
> = {
  queryNeeds,
  evaluateQueryInMemory,
  classifyTriggerFilters,
  triggerFiltersReferenceEvents,
  buildPreconditionTraceDataFromFoldState,
  matchesTriggerFilters,
  matchesEvaluationFilters,
};

/** The app's trace→dataset mapping machinery for the dispatcher. */
export const appDatasetMapping: TriggerActionDispatchDeps<Trace>["datasetMapping"] =
  {
    isTraceExpansion: (key) => key in TRACE_EXPANSIONS,
    mapTraceToDatasetEntry: (trace, mapping, expansions) =>
      mapTraceToDatasetEntry(
        trace,
        mapping as TraceMapping,
        new Set([...expansions] as (keyof typeof TRACE_EXPANSIONS)[]),
        undefined,
        undefined,
      ),
  };

/** `triggerReadsEvaluations` bound to the app kit, so subscribers keep their
 *  point-free `triggers.filter(triggerReadsEvaluations)` call shape. */
export const triggerReadsEvaluations = (trigger: {
  filters: TriggerSummary["filters"];
  filterQuery: TriggerSummary["filterQuery"];
}): boolean => packageTriggerReadsEvaluations(trigger, appTriggerFilterKit);
