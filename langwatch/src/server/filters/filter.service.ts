import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import { createLogger } from "~/utils/logger";
import { ClickHouseFilterService } from "./clickhouse-filter.service";
import {
  ElasticsearchFilterService,
  type FilterOption,
  type GetFilterOptionsInput,
} from "./elasticsearch-filter.service";
import type { FilterField } from "./types";

export type { FilterOption };

/**
 * Unified service for fetching filter options from either ClickHouse or Elasticsearch.
 *
 * This service acts as a facade that:
 * 1. Checks if ClickHouse is enabled for the project (via featureClickHouseDataSourceTraces flag)
 * 2. Routes requests to the appropriate backend based on the feature flag
 * 3. Falls back to Elasticsearch if ClickHouse doesn't support the filter or returns null
 *
 * @example
 * ```ts
 * const service = FilterServiceFacade.create(prisma);
 * const options = await service.getFilterOptions({
 *   projectId: "project-123",
 *   field: "spans.model",
 *   startDate: Date.now() - 86400000,
 *   endDate: Date.now(),
 *   pivotIndexConditions: { ... },
 * });
 * ```
 */
export class FilterServiceFacade {
  private readonly logger = createLogger("langwatch:filters:service");
  private readonly tracer = getLangWatchTracer("langwatch.filters.service");
  private readonly clickHouseService: ClickHouseFilterService;
  private readonly elasticsearchService: ElasticsearchFilterService;

  constructor(readonly prisma: PrismaClient) {
    this.clickHouseService = ClickHouseFilterService.create(prisma);
    this.elasticsearchService = ElasticsearchFilterService.create(prisma);
  }

  /**
   * Static factory method for creating FilterServiceFacade with default dependencies.
   */
  static create(prisma: PrismaClient = defaultPrisma): FilterServiceFacade {
    return new FilterServiceFacade(prisma);
  }

  /**
   * Check if ClickHouse is enabled for the given project.
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    return this.clickHouseService.isClickHouseEnabled(projectId);
  }

  /**
   * Get filter options for a specific filter field.
   *
   * Routes to ClickHouse if enabled and the filter is supported,
   * otherwise falls back to Elasticsearch.
   *
   * @param input - Query parameters including project ID, field, and filters
   * @returns Array of filter options with field, label, and count
   */
  async getFilterOptions(
    input: GetFilterOptionsInput,
  ): Promise<FilterOption[]> {
    return this.tracer.withActiveSpan(
      "FilterServiceFacade.getFilterOptions",
      {
        attributes: {
          "tenant.id": input.projectId,
          "filter.field": input.field,
        },
      },
      async (span) => {
        const useClickHouse = await this.isClickHouseEnabled(input.projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result = await this.clickHouseService.getFilterOptions(
            input.projectId,
            input.field,
            {
              query: input.query,
              key: input.key,
              subkey: input.subkey,
              startDate: input.startDate,
              endDate: input.endDate,
              scopeFilters: input.scopeFilters,
            },
          );

          if (result !== null) {
            span.setAttribute("backend.used", "clickhouse");
            return result;
          }

          // Fall back to Elasticsearch if ClickHouse returns null (filter not supported)
          this.logger.debug(
            { projectId: input.projectId, field: input.field },
            "ClickHouse enabled but returned null for filter, falling back to Elasticsearch",
          );
          span.setAttribute("backend.used", "elasticsearch");
          span.setAttribute("clickhouse.fallback", true);
        }

        return this.elasticsearchService.getFilterOptions(input);
      },
    );
  }
}
