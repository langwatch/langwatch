/**
 * Adapter: wraps the clean app-layer AnalyticsService to implement
 * the legacy AnalyticsBackend interface used by the analytics facade.
 */

import { getClickHouseClientForProject, isClickHouseEnabled } from "~/server/clickhouse/clickhouseClient";
import { AnalyticsService } from "~/server/app-layer/analytics/analytics.service";
import type { AnalyticsBackend, TimeseriesResult, FilterDataResult, TopDocumentsResult, FeedbacksResult } from "../types";
import type { TimeseriesInputType } from "../registry";
import type { FilterField } from "~/server/filters/types";

class AnalyticsBackendAdapter implements AnalyticsBackend {
  constructor(private readonly service: AnalyticsService) {}

  isAvailable(): boolean {
    return isClickHouseEnabled();
  }

  async getTimeseries(input: TimeseriesInputType): Promise<TimeseriesResult> {
    return this.service.getTimeseries(input);
  }

  async getDataForFilter(
    projectId: string,
    field: FilterField,
    startDate: number,
    endDate: number,
    filters?: Partial<Record<FilterField, string[] | Record<string, string[]> | Record<string, Record<string, string[]>>>>,
    key?: string,
    subkey?: string,
    searchQuery?: string,
  ): Promise<FilterDataResult> {
    const options = await this.service.getFilterOptions({
      projectId,
      field,
      startDate,
      endDate,
      key,
      subkey,
      searchQuery,
    });
    return { options };
  }

  async getTopUsedDocuments(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<TopDocumentsResult> {
    const result = await this.service.getTopDocuments({
      projectId,
      startDate,
      endDate,
    });
    return {
      topDocuments: result.documents,
      totalUniqueDocuments: result.totalUnique,
    };
  }

  async getFeedbacks(
    projectId: string,
    startDate: number,
    endDate: number,
  ): Promise<FeedbacksResult> {
    const events = await this.service.getFeedbacks({
      projectId,
      startDate,
      endDate,
    });
    return { events };
  }
}

let instance: AnalyticsBackend | null = null;

export function getProjectionAnalyticsService(): AnalyticsBackend {
  if (!instance) {
    const service = new AnalyticsService(getClickHouseClientForProject);
    instance = new AnalyticsBackendAdapter(service);
  }
  return instance;
}

export function resetProjectionAnalyticsService(): void {
  instance = null;
}
