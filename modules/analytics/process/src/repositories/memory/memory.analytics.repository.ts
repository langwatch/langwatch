import type {
  AnalyticsFeedbacksResult,
  AnalyticsTable,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
  AnalyticsTopDocumentsResult,
} from "@langwatch/analytics-contract";

import { AnalyticsRepository } from "../analytics.repository.ts";
import { pickAnalyticsTable } from "../clickhouse/clickhouse.analytics-route-table.mapper.ts";

/**
 * The timeseries and legacy reads' memory twin. It routes a read to the table the live tier
 * would, and answers each with no rows: the aggregations are ClickHouse SQL, not kept here.
 */
export class MemoryAnalyticsRepository extends AnalyticsRepository {
  static create(): MemoryAnalyticsRepository {
    return new MemoryAnalyticsRepository();
  }

  private constructor() {
    super();
  }

  tableFor(input: AnalyticsTimeseriesInput): AnalyticsTable {
    return pickAnalyticsTable(input);
  }

  runTimeseries(): Promise<AnalyticsTimeseriesResult> {
    return Promise.resolve({ previousPeriod: [], currentPeriod: [] });
  }

  findFeedbackEvents(): Promise<AnalyticsFeedbacksResult> {
    return Promise.resolve({ events: [] });
  }

  findTopDocuments(): Promise<AnalyticsTopDocumentsResult> {
    return Promise.resolve({ topDocuments: [], totalUniqueDocuments: 0 });
  }
}
