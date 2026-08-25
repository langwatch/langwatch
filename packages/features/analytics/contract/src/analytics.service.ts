import type {
  AnalyticsFeedbacksResult,
  AnalyticsReadInput,
  AnalyticsTopDocumentsResult,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
} from "./analytics.timeseries";

export interface AnalyticsTimeseriesReadOptions {
  readonly maxResultRows?: number;
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

  abstract getTopUsedDocuments(
    input: AnalyticsReadInput,
  ): Promise<AnalyticsTopDocumentsResult>;
}
