import type {
  AnalyticsFeedbacksResult,
  AnalyticsFilters,
  AnalyticsTopDocumentsResult,
  AnalyticsTable,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";

export interface AnalyticsTimeseriesQuery {
  readonly table: AnalyticsTable;
  readonly tenantId: string;
  readonly input: AnalyticsTimeseriesInput;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly previousPeriodStartDate: Date;
  readonly adjustedTimeScale: number | "full" | undefined;
  readonly maxResultRows: number | undefined;
}

export interface AnalyticsLegacyReadInput {
  readonly projectId: string;
  readonly startDate: number;
  readonly endDate: number;
  readonly filters?: AnalyticsFilters;
}

/** The single persistence capability owned by Analytics. */
export abstract class AnalyticsRepository {
  abstract runTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult>;

  abstract findFeedbackEvents(input: AnalyticsLegacyReadInput): Promise<AnalyticsFeedbacksResult>;

  abstract findTopDocuments(input: AnalyticsLegacyReadInput): Promise<AnalyticsTopDocumentsResult>;
}
