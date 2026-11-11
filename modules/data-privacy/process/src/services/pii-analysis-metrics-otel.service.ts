import {
  counter,
  histogram,
  type CounterHandle,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

/** How a Presidio batch ended, as the counter labels it. */
export type PiiAnalysisOutcome = "processed" | "skipped" | "error";

/**
 * Series names and evaluator labels are pinned and read externally; renamed
 * series produce empty panels without error.
 */
export const PII_CHECKS_METRIC_NAME = "pii_checks";
export const PII_ANALYSIS_DURATION_METRIC_NAME = "evaluation_duration_milliseconds";
export const PII_ANALYSIS_STATUS_METRIC_NAME = "evaluation_status_counter";
export const PII_ANALYSIS_EVALUATOR_TYPE = "presidio/pii_detection";
/** The PII redaction model's own label on the duration and status series. */
export const PII_REDACTION_MODEL_EVALUATOR_TYPE = "pii_redaction_model";
export const PII_REDACTION_MODEL_FALLBACKS_METRIC_NAME = "pii_redaction_model_fallbacks";

/** Which analysis service answered a batch; each keeps its own label on the shared series. */
export type PiiAnalysisMethod = "presidio" | "pii_redaction_model";

const EVALUATOR_TYPE_BY_METHOD: Readonly<Record<PiiAnalysisMethod, string>> = {
  presidio: PII_ANALYSIS_EVALUATOR_TYPE,
  pii_redaction_model: PII_REDACTION_MODEL_EVALUATOR_TYPE,
};

/** Why a batch routed to the PII redaction model went to Presidio instead. */
export type PiiRedactionModelFallbackReason =
  | "too_long"
  | "timeout"
  | "throttled"
  | "error"
  | "breaker_open"
  | "routing_error";

/** External PII analysis counts and durations, pushed over OTLP. */
export class PiiAnalysisMetricsOtelService {
  static create(): PiiAnalysisMetricsOtelService {
    return new PiiAnalysisMetricsOtelService({
      checks: counter({
        name: PII_CHECKS_METRIC_NAME,
        description: "Number of PII checks for the given method",
      }),
      duration: histogram({
        name: PII_ANALYSIS_DURATION_METRIC_NAME,
        description: "Duration of evaluations in milliseconds",
      }),
      status: counter({
        name: PII_ANALYSIS_STATUS_METRIC_NAME,
        description: "Count of evaluations status results",
      }),
      modelFallbacks: counter({
        name: PII_REDACTION_MODEL_FALLBACKS_METRIC_NAME,
        description: "Batches routed to the PII redaction model that went to Presidio, by reason",
      }),
    });
  }

  private readonly checks: CounterHandle;
  private readonly duration: HistogramHandle;
  private readonly status: CounterHandle;
  private readonly modelFallbacks: CounterHandle;

  private constructor(series: {
    checks: CounterHandle;
    duration: HistogramHandle;
    status: CounterHandle;
    modelFallbacks: CounterHandle;
  }) {
    this.checks = series.checks;
    this.duration = series.duration;
    this.status = series.status;
    this.modelFallbacks = series.modelFallbacks;
  }

  analysisCalled(method: string): void {
    this.checks.inc({ method });
  }

  analysisObserved(durationMs: number, method: PiiAnalysisMethod): void {
    this.duration.observe(durationMs, { evaluator_type: EVALUATOR_TYPE_BY_METHOD[method] });
  }

  analysisFinished(outcome: PiiAnalysisOutcome, method: PiiAnalysisMethod): void {
    this.status.inc({ evaluator_type: EVALUATOR_TYPE_BY_METHOD[method], status: outcome });
  }

  modelFellBack(reason: PiiRedactionModelFallbackReason): void {
    this.modelFallbacks.inc({ reason });
  }
}
