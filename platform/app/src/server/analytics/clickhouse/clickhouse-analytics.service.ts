/**
 * ClickHouse Analytics Service
 *
 * Legacy (pre-ADR-034) analytics reads that have no routed replacement:
 * filter-dropdown options, top-used documents, and feedback events. The
 * query, the client resolution and the row decoding live in
 * `LegacyAnalyticsBackendClickHouseRepository`; this service keeps tracing
 * and the `AnalyticsBackend` contract the app-layer `AnalyticsService`
 * composes it behind.
 */

import { getLangWatchTracer } from "langwatch";
import type { LegacyAnalyticsBackendRepository } from "~/server/app-layer/analytics/repositories/legacy-analytics-backend.clickhouse.repository";
import { isClickHouseEnabled } from "../../clickhouse/clickhouseClient";
import type { FilterField } from "../../filters/types";
import type {
  FeedbacksResult,
  FilterDataResult,
  TimeseriesResult,
  TopDocumentsResult,
} from "../types";

/**
 * Default ClickHouse settings applied to all analytics queries.
 *
 * max_memory_usage is intentionally omitted: the ClickHouse server profile
 * already enforces a per-query memory cap via Terraform (1.5–2 GiB depending
 * on cluster). Setting it client-side would override that cap upward, which
 * is counterproductive.
 *
 * max_bytes_before_external_group_by: When GROUP BY intermediate state exceeds
 * this threshold (500 MB), ClickHouse spills to disk instead of failing with OOM.
 * This acts as a safety net for large GROUP BY operations under concurrent load.
 */
export const ANALYTICS_CLICKHOUSE_SETTINGS: Record<string, number> = {
  max_bytes_before_external_group_by: 500_000_000,
};

// Re-export types for backward compatibility
export type {
  FeedbacksResult,
  FilterDataResult,
  TimeseriesResult,
  TopDocumentsResult,
};

/**
 * ClickHouse Analytics Service
 *
 * Provides analytics queries using ClickHouse.
 */
export class ClickHouseAnalyticsService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.analytics.clickhouse",
  );

  /**
   * `null` on a deployment without ClickHouse, which is a real configuration
   * rather than a fault - it fails at the call, with the same message it
   * always did, instead of at boot.
   */
  constructor(
    private readonly repository: LegacyAnalyticsBackendRepository | null,
  ) {}

  /**
   * Check if the shared ClickHouse instance is configured (sync, for AnalyticsBackend interface).
   */
  isAvailable(): boolean {
    return isClickHouseEnabled();
  }

  /**
   * Get data for filter dropdown
   */
  async getDataForFilter(
    projectId: string,
    field: FilterField,
    startDate: number,
    endDate: number,
    filters?: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
    key?: string,
    subkey?: string,
    searchQuery?: string,
  ): Promise<FilterDataResult> {
    return this.tracer.withActiveSpan(
      "ClickHouseAnalyticsService.getDataForFilter",
      { attributes: { "tenant.id": projectId, "filter.field": field } },
      async (span) => {
        if (!this.repository) {
          throw new Error("ClickHouse client not available");
        }
        const result = await this.repository.findFilterOptions({
          projectId,
          field,
          startDate,
          endDate,
          filters,
          key,
          subkey,
          searchQuery,
        });
        span.setAttribute("result.count", result.options.length);
        return result;
      },
    );
  }

  /**
   * Get top used documents (RAG analytics)
   */
  async getTopUsedDocuments(
    projectId: string,
    startDate: number,
    endDate: number,
    filters?: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<TopDocumentsResult> {
    return this.tracer.withActiveSpan(
      "ClickHouseAnalyticsService.getTopUsedDocuments",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        if (!this.repository) {
          throw new Error("ClickHouse client not available");
        }
        const result = await this.repository.findTopDocuments({
          projectId,
          startDate,
          endDate,
          filters,
        });
        span.setAttribute("document.count", result.topDocuments.length);
        return result;
      },
    );
  }

  /**
   * Get feedbacks (thumbs up/down events with feedback text)
   */
  async getFeedbacks(
    projectId: string,
    startDate: number,
    endDate: number,
    filters?: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<FeedbacksResult> {
    return this.tracer.withActiveSpan(
      "ClickHouseAnalyticsService.getFeedbacks",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        if (!this.repository) {
          throw new Error("ClickHouse client not available");
        }
        const result = await this.repository.findFeedbackEvents({
          projectId,
          startDate,
          endDate,
          filters,
        });
        span.setAttribute("event.count", result.events.length);
        return result;
      },
    );
  }
}
