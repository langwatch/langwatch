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
import type { ElasticSearchEvent } from "../tracer/types";
import type { SharedFiltersInput } from "./types";
import type { TimeseriesInputType } from "./registry";
import {
  type TimeseriesResult,
  type FilterDataResult,
  type TopDocumentsResult,
  type FeedbacksResult,
  getElasticsearchAnalyticsService,
} from "./elasticsearch-analytics.service";
import { getClickHouseAnalyticsService } from "./clickhouse/clickhouse-analytics.service";
import { createLogger } from "../../utils/logger";
import { env } from "../../env.mjs";

const logger = createLogger("langwatch:analytics:service");

/**
 * Comparison mode result for debugging
 */
interface ComparisonResult<T> {
  result: T;
  esResult?: T;
  chResult?: T;
  discrepancies?: string[];
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
  private readonly esService = getElasticsearchAnalyticsService();
  private readonly chService = getClickHouseAnalyticsService();
  private readonly logger = createLogger("langwatch:analytics:service");
  private readonly tracer = getLangWatchTracer("langwatch.analytics.service");

  constructor(prisma: PrismaClient = defaultPrisma) {
    this.prisma = prisma;
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
    return env.ANALYTICS_COMPARISON_MODE === "true";
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
            this.logDiscrepancies("getTimeseries", input, esData, chData);
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
            this.logDiscrepancies(
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
            this.logDiscrepancies(
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
            this.logDiscrepancies(
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

  /**
   * Log discrepancies between ES and CH results
   */
  private logDiscrepancies<T>(
    operation: string,
    input: unknown,
    esResult: T,
    chResult: T,
  ): void {
    const discrepancies = this.findDiscrepancies(esResult, chResult);

    if (discrepancies.length > 0) {
      this.logger.warn(
        {
          operation,
          input,
          discrepancyCount: discrepancies.length,
          discrepancies: discrepancies.slice(0, 10), // Limit logged discrepancies
          esResultSample: this.summarize(esResult),
          chResultSample: this.summarize(chResult),
        },
        "Analytics comparison mode: discrepancies found between ES and CH",
      );
    } else {
      this.logger.debug(
        { operation },
        "Analytics comparison mode: ES and CH results match",
      );
    }
  }

  /**
   * Find discrepancies between two results
   */
  private findDiscrepancies<T>(esResult: T, chResult: T): string[] {
    const discrepancies: string[] = [];

    // For timeseries results, compare bucket counts and values
    if (this.isTimeseriesResult(esResult) && this.isTimeseriesResult(chResult)) {
      if (
        esResult.currentPeriod.length !== chResult.currentPeriod.length
      ) {
        discrepancies.push(
          `Current period bucket count: ES=${esResult.currentPeriod.length}, CH=${chResult.currentPeriod.length}`,
        );
      }

      // Compare values within a tolerance
      for (let i = 0; i < Math.min(esResult.currentPeriod.length, chResult.currentPeriod.length); i++) {
        const esBucket = esResult.currentPeriod[i];
        const chBucket = chResult.currentPeriod[i];

        if (!esBucket || !chBucket) continue;

        for (const key of Object.keys(esBucket)) {
          if (key === "date") continue;

          const esValue = esBucket[key];
          const chValue = chBucket[key];

          if (typeof esValue === "number" && typeof chValue === "number") {
            const tolerance = Math.max(Math.abs(esValue * 0.05), 1); // 5% or 1
            if (Math.abs(esValue - chValue) > tolerance) {
              discrepancies.push(
                `Bucket ${i} key ${key}: ES=${esValue}, CH=${chValue}`,
              );
            }
          }
        }
      }
    }

    // For filter data results, compare option counts
    if (this.isFilterDataResult(esResult) && this.isFilterDataResult(chResult)) {
      if (esResult.options.length !== chResult.options.length) {
        discrepancies.push(
          `Option count: ES=${esResult.options.length}, CH=${chResult.options.length}`,
        );
      }

      // Compare counts for matching fields
      const esOptionMap = new Map(
        esResult.options.map((o) => [o.field, o.count]),
      );
      for (const chOption of chResult.options) {
        const esCount = esOptionMap.get(chOption.field);
        if (esCount !== undefined) {
          const tolerance = Math.max(Math.abs(esCount * 0.05), 1);
          if (Math.abs(esCount - chOption.count) > tolerance) {
            discrepancies.push(
              `Option ${chOption.field}: ES=${esCount}, CH=${chOption.count}`,
            );
          }
        }
      }
    }

    return discrepancies;
  }

  /**
   * Type guard for timeseries results
   */
  private isTimeseriesResult(value: unknown): value is TimeseriesResult {
    return (
      typeof value === "object" &&
      value !== null &&
      "currentPeriod" in value &&
      "previousPeriod" in value
    );
  }

  /**
   * Type guard for filter data results
   */
  private isFilterDataResult(value: unknown): value is FilterDataResult {
    return (
      typeof value === "object" &&
      value !== null &&
      "options" in value &&
      Array.isArray((value as FilterDataResult).options)
    );
  }

  /**
   * Summarize a result for logging
   */
  private summarize<T>(result: T): unknown {
    if (this.isTimeseriesResult(result)) {
      return {
        currentPeriodBuckets: result.currentPeriod.length,
        previousPeriodBuckets: result.previousPeriod.length,
        firstCurrentBucket: result.currentPeriod[0],
      };
    }
    if (this.isFilterDataResult(result)) {
      return {
        optionCount: result.options.length,
        firstOptions: result.options.slice(0, 3),
      };
    }
    return result;
  }
}

/**
 * Singleton instance
 */
let analyticsService: AnalyticsService | null = null;

/**
 * Get the analytics service instance
 */
export function getAnalyticsService(prisma?: PrismaClient): AnalyticsService {
  if (!analyticsService) {
    analyticsService = new AnalyticsService(prisma);
  }
  return analyticsService;
}
