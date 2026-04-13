/**
 * Analytics Service Facade
 *
 * Routes analytics queries to ClickHouse.
 */

import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "../db";
import type { FilterField } from "../filters/types";
import { TtlCache } from "../utils/ttlCache";
import type {
  TimeseriesResult,
  FilterDataResult,
  TopDocumentsResult,
  FeedbacksResult,
  AnalyticsBackend,
} from "./types";
import type { TimeseriesInputType } from "./registry";
import { getClickHouseAnalyticsService } from "./clickhouse/clickhouse-analytics.service";

const TIMESERIES_CACHE_TTL_MS = 30_000 as const;

/**
 * Dependencies required by AnalyticsService
 */
export interface AnalyticsServiceDependencies {
  chService: AnalyticsBackend;
  prisma: PrismaClient;
}

/**
 * Analytics Service Facade
 *
 * Routes analytics queries to ClickHouse.
 */
export class AnalyticsService {
  private readonly prisma: PrismaClient;
  private readonly chService: AnalyticsBackend;
  private readonly tracer = getLangWatchTracer("langwatch.analytics.service");
  private readonly timeseriesCache = new TtlCache<TimeseriesResult>(
    TIMESERIES_CACHE_TTL_MS,
    "analytics:ts:",
  );

  constructor(deps: AnalyticsServiceDependencies) {
    this.chService = deps.chService;
    this.prisma = deps.prisma;
  }

  /**
   * Execute an analytics operation.
   */
  private async executeWithRouting<TResult>(
    operationName: string,
    projectId: string,
    chCall: () => Promise<TResult>,
  ): Promise<TResult> {
    return this.tracer.withActiveSpan(
      `AnalyticsService.${operationName}`,
      { attributes: { "tenant.id": projectId } },
      async () => {
        return chCall();
      },
    );
  }

  /**
   * Get timeseries analytics data (with 30s TTL cache)
   */
  async getTimeseries(input: TimeseriesInputType): Promise<TimeseriesResult> {
    return this.executeWithRouting(
      "getTimeseries",
      input.projectId,
      async () => {
        const cacheKey = `${input.projectId}:${JSON.stringify(input)}`;
        const cached = await this.timeseriesCache.get(cacheKey);
        if (cached) return cached;

        const result = await this.chService.getTimeseries(input);
        await this.timeseriesCache.set(cacheKey, result);
        return result;
      },
    );
  }

  /**
   * Get data for filter dropdown
   */
  async getDataForFilter(
    projectId: string,
    field: FilterField,
    startDate: number,
    endDate: number,
    filters: Partial<
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
    return this.executeWithRouting(
      "getDataForFilter",
      projectId,
      () =>
        this.chService.getDataForFilter(
          projectId,
          field,
          startDate,
          endDate,
          filters,
          key,
          subkey,
          searchQuery,
        ),
    );
  }

  /**
   * Get top used documents (RAG analytics)
   */
  async getTopUsedDocuments(
    projectId: string,
    startDate: number,
    endDate: number,
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<TopDocumentsResult> {
    return this.executeWithRouting(
      "getTopUsedDocuments",
      projectId,
      () =>
        this.chService.getTopUsedDocuments(
          projectId,
          startDate,
          endDate,
          filters,
        ),
    );
  }

  /**
   * Get feedbacks (thumbs up/down events with feedback text)
   */
  async getFeedbacks(
    projectId: string,
    startDate: number,
    endDate: number,
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<FeedbacksResult> {
    return this.executeWithRouting(
      "getFeedbacks",
      projectId,
      () => this.chService.getFeedbacks(projectId, startDate, endDate, filters),
    );
  }
}

/**
 * Create an AnalyticsService with production dependencies
 */
export function createAnalyticsService(
  prisma: PrismaClient = defaultPrisma,
): AnalyticsService {
  return new AnalyticsService({
    chService: getClickHouseAnalyticsService(),
    prisma,
  });
}

/**
 * Singleton instance
 */
let analyticsService: AnalyticsService | null = null;

/**
 * Get the analytics service singleton instance
 */
export function getAnalyticsService(prisma?: PrismaClient): AnalyticsService {
  if (!analyticsService) {
    analyticsService = createAnalyticsService(prisma);
  }
  return analyticsService;
}

/**
 * Reset the singleton (for testing)
 */
export function resetAnalyticsService(): void {
  analyticsService = null;
}
