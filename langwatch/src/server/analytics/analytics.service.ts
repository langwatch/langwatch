/**
 * Analytics Service Facade
 *
 * Routes analytics queries to the appropriate backend based on feature flags:
 * 1. Projection-based fact tables (PostHog flag: analytics_projections_enabled)
 * 2. ClickHouse entity tables (Prisma flag: featureClickHouseDataSourceTraces)
 * 3. Elasticsearch (default fallback)
 *
 * Supports comparison mode for verifying results between backends.
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
import { getProjectionAnalyticsService } from "./projection/index";
import { featureFlagService } from "~/server/featureFlag";
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
 * Minimal interface for feature flag evaluation, allowing injection for testing.
 */
export interface AnalyticsFeatureFlagService {
  isEnabled(
    flagKey: string,
    distinctId: string,
    defaultValue: boolean,
    options?: { projectId?: string },
  ): Promise<boolean>;
}

/**
 * Dependencies required by AnalyticsService
 */
export interface AnalyticsServiceDependencies {
  esService: AnalyticsBackend;
  chService: AnalyticsBackend;
  projectionService?: AnalyticsBackend;
  prisma: PrismaClient;
  comparator?: AnalyticsComparator;
  featureFlagService?: AnalyticsFeatureFlagService;
  config?: AnalyticsServiceConfig;
}

/**
 * Analytics Service Facade
 *
 * This facade routes analytics requests to the appropriate backend
 * based on feature flags. Routing priority:
 *
 * 1. **Projection service** - PostHog flag `analytics_projections_enabled`
 *    (or env var `ANALYTICS_PROJECTIONS_ENABLED=1`). Uses pre-built
 *    denormalized fact tables for fast, JOIN-free queries.
 * 2. **ClickHouse** - Prisma flag `featureClickHouseDataSourceTraces`.
 *    Queries entity-oriented tables with JOINs.
 * 3. **Elasticsearch** - Default fallback.
 *
 * In comparison mode, results from the experimental backend are compared
 * against the baseline and discrepancies are logged.
 */
export class AnalyticsService {
  private readonly prisma: PrismaClient;
  private readonly esService: AnalyticsBackend;
  private readonly chService: AnalyticsBackend;
  private readonly projectionService?: AnalyticsBackend;
  private readonly comparator: AnalyticsComparator;
  private readonly featureFlagService?: AnalyticsFeatureFlagService;
  private readonly config: AnalyticsServiceConfig;
  private readonly logger = createLogger("langwatch:analytics:service");
  private readonly tracer = getLangWatchTracer("langwatch.analytics.service");

  constructor(deps: AnalyticsServiceDependencies) {
    this.esService = deps.esService;
    this.chService = deps.chService;
    this.projectionService = deps.projectionService;
    this.prisma = deps.prisma;
    this.comparator = deps.comparator ?? getAnalyticsComparator();
    this.featureFlagService = deps.featureFlagService;
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
        "Failed to check ClickHouse feature flag, defaulting to ES",
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
    projectionCall?: () => Promise<TResult>,
  ): Promise<TResult> {
    return this.tracer.withActiveSpan(
      `AnalyticsService.${operationName}`,
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        // Check projection-based analytics before existing routing
        const useProjections = await this.isProjectionsEnabled(projectId);

        if (useProjections && projectionCall) {
          span.setAttribute("backend", "projections");
          const comparisonMode = this.isComparisonModeEnabled();
          span.setAttribute("comparison.mode", comparisonMode);

          if (comparisonMode && this.chService.isAvailable()) {
            // In comparison mode, compare projection results against CH (baseline)
            return this.runComparison(
              operationName,
              input,
              chCall,
              projectionCall,
              true, // useClickHouse=true makes chCall the baseline, projectionCall the primary
            );
          }

          return projectionCall();
        }

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
   * Check if projection-based analytics is enabled for the given project.
   *
   * Returns true only when:
   * 1. A projection service is injected and reports itself as available
   * 2. The PostHog feature flag `analytics_projections_enabled` is on for the project
   *    (or force-enabled via ANALYTICS_PROJECTIONS_ENABLED=1 env var)
   */
  private async isProjectionsEnabled(projectId: string): Promise<boolean> {
    if (!this.projectionService?.isAvailable()) {
      return false;
    }

    if (!this.featureFlagService) {
      return false;
    }

    try {
      return await this.featureFlagService.isEnabled(
        "analytics_projections_enabled",
        projectId,
        false,
        { projectId },
      );
    } catch (error) {
      this.logger.warn(
        { projectId, error: error instanceof Error ? error.message : error },
        "Failed to check projection feature flag, defaulting to off",
      );
      return false;
    }
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

    const primaryData = useClickHouse ? chData : esData;
    if (!primaryData) {
      throw new Error(
        `${useClickHouse ? "ClickHouse" : "Elasticsearch"} ${operationName} query failed in comparison mode`,
      );
    }
    return primaryData;
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
      this.projectionService
        ? () => this.projectionService!.getTimeseries(input)
        : undefined,
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
      this.projectionService
        ? () =>
            this.projectionService!.getDataForFilter(
              projectId,
              field,
              startDate,
              endDate,
              filters,
              key,
              subkey,
              searchQuery,
            )
        : undefined,
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
      this.projectionService
        ? () =>
            this.projectionService!.getTopUsedDocuments(
              projectId,
              startDate,
              endDate,
              filters,
            )
        : undefined,
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
      this.projectionService
        ? () =>
            this.projectionService!.getFeedbacks(
              projectId,
              startDate,
              endDate,
              filters,
            )
        : undefined,
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
    projectionService: getProjectionAnalyticsService(),
    prisma,
    featureFlagService,
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
