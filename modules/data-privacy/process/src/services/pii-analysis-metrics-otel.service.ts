import {
  counter,
  histogram,
  type CounterHandle,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

import { type PiiAnalysisMetrics, type PiiAnalysisOutcome } from "../app/data-privacy.members.ts";

/**
 * Series names and evaluator labels are pinned and read externally; renamed
 * series produce empty panels without error.
 */
export const PII_CHECKS_METRIC_NAME = "pii_checks";
export const PII_ANALYSIS_DURATION_METRIC_NAME = "evaluation_duration_milliseconds";
export const PII_ANALYSIS_STATUS_METRIC_NAME = "evaluation_status_counter";
export const PII_ANALYSIS_EVALUATOR_TYPE = "presidio/pii_detection";

/** External PII analysis counts and durations, pushed over OTLP. */
export class PiiAnalysisMetricsOtelService implements PiiAnalysisMetrics {
  static create(): PiiAnalysisMetricsOtelService {
    return new PiiAnalysisMetricsOtelService(
      counter({
        name: PII_CHECKS_METRIC_NAME,
        description: "Number of PII checks for the given method",
      }),
      histogram({
        name: PII_ANALYSIS_DURATION_METRIC_NAME,
        description: "Duration of evaluations in milliseconds",
      }),
      counter({
        name: PII_ANALYSIS_STATUS_METRIC_NAME,
        description: "Count of evaluations status results",
      }),
    );
  }

  private constructor(
    private readonly checks: CounterHandle,
    private readonly duration: HistogramHandle,
    private readonly status: CounterHandle,
  ) {}

  analysisCalled(method: string): void {
    this.checks.inc({ method });
  }

  analysisObserved(durationMs: number): void {
    this.duration.observe(durationMs, { evaluator_type: PII_ANALYSIS_EVALUATOR_TYPE });
  }

  analysisFinished(outcome: PiiAnalysisOutcome): void {
    this.status.inc({ evaluator_type: PII_ANALYSIS_EVALUATOR_TYPE, status: outcome });
  }
}
