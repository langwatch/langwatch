import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type { DerivedTraceEvent, TraceSummaryData } from "@langwatch/trace-contract";
import type { TriggerSummary } from "@langwatch/automation-contract";

/** Dispatch-time recheck against the settled trace. This has one
 * compatibility implementation while the trace filter evaluator finishes its
 * own extraction; it cannot choose delivery, claims, caps, or retries. */
export abstract class AutomationSettlementMatchConfirmation {
  abstract confirms(input: {
    trigger: TriggerSummary;
    projectId: string;
    traceId: string;
    foldState: TraceSummaryData;
  }): Promise<boolean>;
}

/** The host owns the trace-query engine and legacy trace-filter matcher. It
 * receives already-loaded state; deciding which reads are needed and whether a
 * settled match may continue is Automation settlement policy. */
export abstract class AutomationSettlementFilterEvaluator {
  abstract matchesFilterQuery(input: {
    query: string;
    foldState: TraceSummaryData;
    evaluations: EvaluationRunData[] | null;
    events: DerivedTraceEvent[] | null;
  }): boolean;

  abstract matchesTraceFilters(input: {
    filters: Record<string, unknown>;
    foldState: TraceSummaryData;
    events: DerivedTraceEvent[] | null;
  }): boolean;

  abstract matchesEvaluationFilters(input: {
    filters: Record<string, unknown>;
    evaluations: EvaluationRunData[];
  }): boolean;
}
