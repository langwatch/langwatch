import type { AnalyticsAggregation, AnalyticsSeries } from "@langwatch/analytics-contract";

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

export type AggregationTypes = AnalyticsAggregation;
export type PercentileAggregationTypes = Extract<
  AnalyticsAggregation,
  "median" | "p99" | "p95" | "p90"
>;
export type PipelineAggregationTypes = Extract<AnalyticsAggregation, "sum" | "avg" | "min" | "max">;
