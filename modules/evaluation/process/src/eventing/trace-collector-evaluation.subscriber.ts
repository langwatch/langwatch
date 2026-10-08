/**
 * Evaluation's peer reaction to trace's "evaluations received" fact (T1 D1, R38, §9): each
 * evaluation a collector body carried is reported on evaluation's own reportEvaluation command.
 */
import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import {
  type CollectorEvaluationReceivedEventData,
  collectorEvaluationReceivedEventDataSchema,
} from "@langwatch/trace-contract";

/** All of the fact this subscriber reads: the evaluation as the collector door built it. */
export const traceCollectorEvaluationSchema = collectorEvaluationReceivedEventDataSchema;

export interface TraceCollectorEvaluationDeps {
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<void>;
}

/** The report the collector used to send itself; redelivery reports the same evaluation id. */
export function createTraceCollectorEvaluationReport(
  deps: TraceCollectorEvaluationDeps,
): (data: CollectorEvaluationReceivedEventData) => Promise<void> {
  return (data) => deps.reportEvaluation({ ...data });
}
