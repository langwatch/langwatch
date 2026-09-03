import type {
  AnalyticsFeedbacksResult,
  AnalyticsReadInput,
  AnalyticsTopDocumentsResult,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
} from "./analytics.timeseries";
import type {
  AnalyticsEvaluationReadInput,
  AnalyticsEvaluationRollupAppendBatchInput,
  AnalyticsEvaluationRollupAppendInput,
  AnalyticsEvaluationRow,
  AnalyticsEvaluationUpsertInput,
} from "./analytics.evaluation";

export interface AnalyticsTimeseriesReadOptions {
  readonly maxResultRows?: number;
}

export interface AnalyticsEvaluationReadMetrics {
  record(input: {
    table: "evaluation_analytics";
    outcome: "hit" | "windowed_empty" | "unwindowed" | "error";
  }): void;
}

export abstract class AnalyticsTripwire {
  abstract isEnabled(projectId: string): Promise<boolean>;
  abstract compare(input: {
    projectId: string;
    table: string;
    routed: AnalyticsTimeseriesResult;
    legacy: AnalyticsTimeseriesResult;
  }): void;
}

export abstract class AnalyticsService {
  abstract getTimeseries(
    input: AnalyticsTimeseriesInput,
    options?: AnalyticsTimeseriesReadOptions,
  ): Promise<AnalyticsTimeseriesResult>;

  abstract getFeedbacks(input: AnalyticsReadInput): Promise<AnalyticsFeedbacksResult>;

  abstract getTopUsedDocuments(input: AnalyticsReadInput): Promise<AnalyticsTopDocumentsResult>;

  abstract upsertEvaluationAnalytics(input: AnalyticsEvaluationUpsertInput): Promise<void>;

  abstract upsertEvaluationAnalyticsBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void>;

  abstract tryGetEvaluationAnalytics(input: AnalyticsEvaluationReadInput): Promise<{
    row: AnalyticsEvaluationRow;
    appliedEventIds: string[];
  } | null>;

  abstract appendEvaluationAnalyticsRollup(
    input: AnalyticsEvaluationRollupAppendInput,
  ): Promise<void>;

  abstract appendEvaluationAnalyticsRollupBatch(
    input: AnalyticsEvaluationRollupAppendBatchInput,
  ): Promise<void>;
}
