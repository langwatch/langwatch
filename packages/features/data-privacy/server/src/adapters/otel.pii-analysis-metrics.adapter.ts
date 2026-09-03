import {
  counter,
  histogram,
  type CounterHandle,
  type HistogramHandle,
} from "@langwatch/observability/metrics";
import {
  PiiAnalysisMetricsPort,
  type PiiAnalysisOutcome,
} from "../ports/pii-analysis-metrics.port";

/**
 * The three series names, and the evaluator label the two duration/status
 * series carry, pinned because two processes write them.
 *
 * Every one of these is read by name somewhere outside this repository, and
 * every one of them fails silently: a renamed series produces an empty panel,
 * not an error, and an empty PII-analysis panel reads exactly like "no traffic"
 * rather than "the metric moved". `evaluation_duration_milliseconds` and
 * `evaluation_status_counter` are shared with the evaluator pipeline and are
 * distinguished only by `evaluator_type`, so the label value is as
 * load-bearing as the name.
 */
export const PII_CHECKS_METRIC_NAME = "pii_checks";
export const PII_ANALYSIS_DURATION_METRIC_NAME = "evaluation_duration_milliseconds";
export const PII_ANALYSIS_STATUS_METRIC_NAME = "evaluation_status_counter";
export const PII_ANALYSIS_EVALUATOR_TYPE = "presidio/pii_detection";

/** External PII analysis counts and durations, pushed over OTLP. */
export class OtelPiiAnalysisMetricsAdapter extends PiiAnalysisMetricsPort {
  static create(): OtelPiiAnalysisMetricsAdapter {
    return new OtelPiiAnalysisMetricsAdapter(
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
  ) {
    super();
  }

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
