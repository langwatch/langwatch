/**
 * Analytics Service Facade
 *
 * Routes analytics queries to either Elasticsearch or ClickHouse based on
 * the project's featureClickHouseDataSourceTraces flag.
 *
 * Supports comparison mode for verifying CH results against ES results.
 */

import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "../db";
import type { FilterField } from "../filters/types";
import type {
  TimeseriesResult,
  FilterDataResult,
  TopDocumentsResult,
  FeedbacksResult,
  AnalyticsBackend,
} from "./types";
import type { TimeseriesInputType } from "./registry";
import { getElasticsearchAnalyticsService } from "./elasticsearch-analytics.service";
import { getClickHouseAnalyticsService } from "./clickhouse/clickhouse-analytics.service";
import { AnalyticsComparator, getAnalyticsComparator } from "./analytics-comparator";
import { createLogger } from "../../utils/logger";

/**
 * Configuration for comparison mode
 */
export interface AnalyticsServiceConfig {
  comparisonModeEnabled?: boolean;
}

/**
 * Dependencies required by AnalyticsService
 */
export interface AnalyticsServiceDependencies {
  esService: AnalyticsBackend;
  chService: AnalyticsBackend;
  prisma: PrismaClient;
  comparator?: AnalyticsComparator;
  config?: AnalyticsServiceConfig;
}

/**
 * Analytics Service Facade
 *
 * This facade routes analytics requests to either Elasticsearch or ClickHouse
 * based on the project's configuration. It supports:
 *
 * - Feature flag based routing (featureClickHouseDataSourceTraces)
 * - Comparison mode for verifying ClickHouse results against Elasticsearch
 * - Logging of discrepancies for debugging
 */
export class AnalyticsService {
  private readonly prisma: PrismaClient;
  private readonly esService: AnalyticsBackend;
  private readonly chService: AnalyticsBackend;
  private readonly comparator: AnalyticsComparator;
  private readonly config: AnalyticsServiceConfig;
  private readonly logger = createLogger("langwatch:analytics:service");
  private readonly tracer = getLangWatchTracer("langwatch.analytics.service");

  constructor(deps: AnalyticsServiceDependencies) {
    this.esService = deps.esService;
    this.chService = deps.chService;
    this.prisma = deps.prisma;
    this.comparator = deps.comparator ?? getAnalyticsComparator();
    this.config = deps.config ?? {};
  }

  /**
   * Check if ClickHouse is enabled for the given project
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    // First check if ClickHouse client is available
    if (!this.chService.isAvailable()) {
      return false;
    }

    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { featureClickHouseDataSourceTraces: true },
      });

      return project?.featureClickHouseDataSourceTraces === true;
    } catch (error) {
      this.logger.warn(
        { projectId, error: error instanceof Error ? error.message : error },
        "Failed to check ClickHouse feature flag, falling back to ES",
      );
      return false;
    }
  }

  /**
   * Check if comparison mode is enabled
   * Comparison mode runs both ES and CH queries and logs discrepancies
   */
  isComparisonModeEnabled(): boolean {
    return this.config.comparisonModeEnabled ?? false;
  }

  /**
   * Get timeseries analytics data
   */
  async getTimeseries(input: TimeseriesInputType): Promise<TimeseriesResult> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getTimeseries",
      { attributes: { "tenant.id": input.projectId } },
      async (span) => {
        const useClickHouse = await this.isClickHouseEnabled(input.projectId);
        const comparisonMode = this.isComparisonModeEnabled();

        span.setAttribute("backend", useClickHouse ? "clickhouse" : "elasticsearch");
        span.setAttribute("comparison.mode", comparisonMode);

        if (comparisonMode && this.chService.isAvailable()) {
          // Run both queries in parallel and compare
          const [esResult, chResult] = await Promise.allSettled([
            this.esService.getTimeseries(input),
            this.chService.getTimeseries(input),
          ]);

          const esData =
            esResult.status === "fulfilled" ? esResult.value : undefined;
          const chData =
            chResult.status === "fulfilled" ? chResult.value : undefined;

          if (esData && chData) {
            this.comparator.compare("getTimeseries", input, esData, chData);
          } else {
            if (esResult.status === "rejected") {
              this.logger.error(
                { error: esResult.reason },
                "ES timeseries query failed in comparison mode",
              );
            }
            if (chResult.status === "rejected") {
              this.logger.error(
                { error: chResult.reason },
                "CH timeseries query failed in comparison mode",
              );
            }
          }

          // Return the appropriate result based on feature flag
          if (useClickHouse && chData) {
            return chData;
          }
          if (esData) {
            return esData;
          }
          // If both failed, throw
          throw new Error("Both ES and CH timeseries queries failed");
        }

        // Normal mode: use the appropriate service
        if (useClickHouse) {
          return this.chService.getTimeseries(input);
        }
        return this.esService.getTimeseries(input);
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
    return this.tracer.withActiveSpan(
      "AnalyticsService.getDataForFilter",
      { attributes: { "tenant.id": projectId, "filter.field": field } },
      async (span) => {
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        const comparisonMode = this.isComparisonModeEnabled();

        span.setAttribute("backend", useClickHouse ? "clickhouse" : "elasticsearch");
        span.setAttribute("comparison.mode", comparisonMode);

        if (comparisonMode && this.chService.isAvailable()) {
          const [esResult, chResult] = await Promise.allSettled([
            this.esService.getDataForFilter(
              projectId,
              field,
              startDate,
              endDate,
              filters,
              key,
              subkey,
              searchQuery,
            ),
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
          ]);

          const esData =
            esResult.status === "fulfilled" ? esResult.value : undefined;
          const chData =
            chResult.status === "fulfilled" ? chResult.value : undefined;

          if (esData && chData) {
            this.comparator.compare(
              "getDataForFilter",
              { projectId, field, startDate, endDate },
              esData,
              chData,
            );
          }

          if (useClickHouse && chData) {
            return chData;
          }
          if (esData) {
            return esData;
          }
          throw new Error("Both ES and CH dataForFilter queries failed");
        }

        if (useClickHouse) {
          return this.chService.getDataForFilter(
            projectId,
            field,
            startDate,
            endDate,
            filters,
            key,
            subkey,
            searchQuery,
          );
        }
        return this.esService.getDataForFilter(
          projectId,
          field,
          startDate,
          endDate,
          filters,
          key,
          subkey,
          searchQuery,
        );
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
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<TopDocumentsResult> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getTopUsedDocuments",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        const comparisonMode = this.isComparisonModeEnabled();

        span.setAttribute("backend", useClickHouse ? "clickhouse" : "elasticsearch");
        span.setAttribute("comparison.mode", comparisonMode);

        if (comparisonMode && this.chService.isAvailable()) {
          const [esResult, chResult] = await Promise.allSettled([
            this.esService.getTopUsedDocuments(
              projectId,
              startDate,
              endDate,
              filters,
            ),
            this.chService.getTopUsedDocuments(
              projectId,
              startDate,
              endDate,
              filters,
            ),
          ]);

          const esData =
            esResult.status === "fulfilled" ? esResult.value : undefined;
          const chData =
            chResult.status === "fulfilled" ? chResult.value : undefined;

          if (esData && chData) {
            this.comparator.compare(
              "getTopUsedDocuments",
              { projectId, startDate, endDate },
              esData,
              chData,
            );
          }

          if (useClickHouse && chData) {
            return chData;
          }
          if (esData) {
            return esData;
          }
          throw new Error("Both ES and CH topUsedDocuments queries failed");
        }

        if (useClickHouse) {
          return this.chService.getTopUsedDocuments(
            projectId,
            startDate,
            endDate,
            filters,
          );
        }
        return this.esService.getTopUsedDocuments(
          projectId,
          startDate,
          endDate,
          filters,
        );
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
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<FeedbacksResult> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getFeedbacks",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        const comparisonMode = this.isComparisonModeEnabled();

        span.setAttribute("backend", useClickHouse ? "clickhouse" : "elasticsearch");
        span.setAttribute("comparison.mode", comparisonMode);

        if (comparisonMode && this.chService.isAvailable()) {
          const [esResult, chResult] = await Promise.allSettled([
            this.esService.getFeedbacks(projectId, startDate, endDate, filters),
            this.chService.getFeedbacks(projectId, startDate, endDate, filters),
          ]);

          const esData =
            esResult.status === "fulfilled" ? esResult.value : undefined;
          const chData =
            chResult.status === "fulfilled" ? chResult.value : undefined;

          if (esData && chData) {
            this.comparator.compare(
              "getFeedbacks",
              { projectId, startDate, endDate },
              esData,
              chData,
            );
          }

          if (useClickHouse && chData) {
            return chData;
          }
          if (esData) {
            return esData;
          }
          throw new Error("Both ES and CH feedbacks queries failed");
        }

        if (useClickHouse) {
          return this.chService.getFeedbacks(projectId, startDate, endDate, filters);
        }
        return this.esService.getFeedbacks(projectId, startDate, endDate, filters);
      },
    );
  }
}

/**
 * Create an AnalyticsService with production dependencies
 */
export function createAnalyticsService(
  prisma: PrismaClient = defaultPrisma,
  config?: AnalyticsServiceConfig,
): AnalyticsService {
  return new AnalyticsService({
    esService: getElasticsearchAnalyticsService(),
    chService: getClickHouseAnalyticsService(),
    prisma,
    config: {
      comparisonModeEnabled: process.env.ANALYTICS_COMPARISON_MODE === "true",
      ...config,
    },
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
