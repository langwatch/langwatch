import type { AnalyticsSeries } from "./analytics.timeseries";

export interface BuiltAnalyticsQuery {
  readonly sql: string;
  readonly params: Record<string, unknown>;
}

export interface AnalyticsTimeseriesBuilderInput {
  readonly projectId: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly previousPeriodStartDate: Date;
  readonly series: AnalyticsSeries[];
  readonly filters?: Record<
    string,
    string[] | Record<string, string[]> | Record<string, Record<string, string[]>>
  >;
  readonly groupBy?: string;
  readonly groupByKey?: string;
  readonly timeScale?: number | "full";
  readonly timeZone?: string;
}
