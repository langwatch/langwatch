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
import {
  AnalyticsComparator,
  getAnalyticsComparator,
} from "./analytics-comparator";
import { createLogger } from "../../utils/logger/server";

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
      this.logger.error(
        { projectId, error: error instanceof Error ? error.message : error },
        "Failed to check ClickHouse feature flag",
      );
      throw error;
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
   * Execute an analytics operation with routing logic.
   *
   * WHY THIS METHOD EXISTS: Four different analytics operations (getTimeseries,
   * getDataForFilter, getTopUsedDocuments, getFeedbacks) all share identical routing
   * logic: check feature flags, route to the correct backend, and optionally run
   * comparison mode. Extracting this logic into a single method:
   * 1. Eliminates ~50 lines of duplication per method
   * 2. Ensures consistent behavior across all operations
   * 3. Makes it easy to add new routing features in one place
   */
  private async executeWithRouting<TResult>(
    operationName: string,
    projectId: string,
    input: unknown,
    esCall: () => Promise<TResult>,
    chCall: () => Promise<TResult>,
  ): Promise<TResult> {
    return this.tracer.withActiveSpan(
      `AnalyticsService.${operationName}`,
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        const comparisonMode = this.isComparisonModeEnabled();

        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );
        span.setAttribute("comparison.mode", comparisonMode);

        if (comparisonMode && this.chService.isAvailable()) {
          return this.runComparison(
            operationName,
            input,
            esCall,
            chCall,
            useClickHouse,
          );
        }

        return useClickHouse ? chCall() : esCall();
      },
    );
  }

  /**
   * Run both ES and CH queries in comparison mode, log discrepancies, and return
   * the appropriate result based on the feature flag.
   */
  private async runComparison<TResult>(
    operationName: string,
    input: unknown,
    esCall: () => Promise<TResult>,
    chCall: () => Promise<TResult>,
    useClickHouse: boolean,
  ): Promise<TResult> {
    const [esResult, chResult] = await Promise.allSettled([esCall(), chCall()]);

    const esData = esResult.status === "fulfilled" ? esResult.value : undefined;
    const chData = chResult.status === "fulfilled" ? chResult.value : undefined;

    if (esData && chData) {
      this.comparator.compare(operationName, input, esData, chData);
    } else {
      this.logComparisonErrors(operationName, esResult, chResult);
    }

    if (useClickHouse && chData) return chData;
    if (esData) return esData;
    throw new Error(`Both ES and CH ${operationName} queries failed`);
  }

  /**
   * Log errors from comparison mode when one or both backends fail.
   */
  private logComparisonErrors<TResult>(
    operationName: string,
    esResult: PromiseSettledResult<TResult>,
    chResult: PromiseSettledResult<TResult>,
  ): void {
    if (esResult.status === "rejected") {
      this.logger.error(
        { error: esResult.reason },
        `ES ${operationName} query failed in comparison mode`,
      );
    }
    if (chResult.status === "rejected") {
      this.logger.error(
        { error: chResult.reason },
        `CH ${operationName} query failed in comparison mode`,
      );
    }
  }

  /**
   * Get timeseries analytics data
   */
  async getTimeseries(input: TimeseriesInputType): Promise<TimeseriesResult> {
    return this.executeWithRouting(
      "getTimeseries",
      input.projectId,
      input,
      () => this.esService.getTimeseries(input),
      () => this.chService.getTimeseries(input),
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
      { projectId, field, startDate, endDate },
      () =>
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
      { projectId, startDate, endDate },
      () =>
        this.esService.getTopUsedDocuments(
          projectId,
          startDate,
          endDate,
          filters,
        ),
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
      { projectId, startDate, endDate },
      () => this.esService.getFeedbacks(projectId, startDate, endDate, filters),
      () => this.chService.getFeedbacks(projectId, startDate, endDate, filters),
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
