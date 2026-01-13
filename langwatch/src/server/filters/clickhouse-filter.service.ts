import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { prisma as defaultPrisma } from "~/server/db";
import { createLogger } from "~/utils/logger";
import { getLangWatchTracer } from "langwatch";
import type { FilterField } from "./types";
import {
  clickHouseFilters,
  type ClickHouseFilterQueryParams,
  type FilterOption,
} from "./clickhouse-registry";

/**
 * Service for fetching filter options from ClickHouse.
 *
 * This service provides a ClickHouse-based alternative to the Elasticsearch
 * filter aggregations. It:
 * 1. Checks if ClickHouse is enabled for the project
 * 2. Executes SQL queries for supported filter fields
 * 3. Returns null for unsupported filters, allowing fallback to Elasticsearch
 */
export class ClickHouseFilterService {
  private readonly clickHouseClient: ClickHouseClient | null;
  private readonly logger = createLogger("langwatch:filters:clickhouse-service");
  private readonly tracer = getLangWatchTracer(
    "langwatch.filters.clickhouse-service"
  );

  constructor(private readonly prisma: PrismaClient) {
    this.clickHouseClient = getClickHouseClient();
  }

  /**
   * Static factory method for creating ClickHouseFilterService with default dependencies.
   */
  static create(prisma: PrismaClient = defaultPrisma): ClickHouseFilterService {
    return new ClickHouseFilterService(prisma);
  }

  /**
   * Check if ClickHouse is enabled for the given project.
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    return await this.tracer.withActiveSpan(
      "ClickHouseFilterService.isClickHouseEnabled",
      {
        attributes: { "tenant.id": projectId },
      },
      async (span) => {
        if (!this.clickHouseClient) {
          return false;
        }

        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { featureClickHouseDataSourceTraces: true },
        });

        span.setAttribute(
          "project.feature.clickhouse",
          project?.featureClickHouseDataSourceTraces === true
        );

        return project?.featureClickHouseDataSourceTraces === true;
      }
    );
  }

  /**
   * Get filter options for a specific filter field.
   *
   * Returns null if:
   * - ClickHouse client is not available
   * - ClickHouse is not enabled for this project
   * - The filter field is not supported in ClickHouse
   *
   * @param projectId - The project ID
   * @param field - The filter field to query
   * @param options - Query options (query string, key, subkey, date range)
   * @returns Array of filter options, or null if not supported
   */
  async getFilterOptions(
    projectId: string,
    field: FilterField,
    options: {
      query?: string;
      key?: string;
      subkey?: string;
      startDate: number;
      endDate: number;
    }
  ): Promise<FilterOption[] | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseFilterService.getFilterOptions",
      {
        attributes: {
          "tenant.id": projectId,
          "filter.field": field,
        },
      },
      async (span) => {
        // Check if ClickHouse is available
        if (!this.clickHouseClient) {
          span.setAttribute("clickhouse.available", false);
          return null;
        }

        // Check if this filter is supported in ClickHouse
        const filterDef = clickHouseFilters[field];
        if (!filterDef || filterDef.tableName === null) {
          span.setAttribute("clickhouse.filter_supported", false);
          this.logger.debug(
            { projectId, field },
            "Filter not supported in ClickHouse, will fall back to Elasticsearch"
          );
          return null;
        }

        span.setAttribute("clickhouse.filter_supported", true);
        span.setAttribute("clickhouse.table", filterDef.tableName);

        try {
          const queryParams: ClickHouseFilterQueryParams = {
            tenantId: projectId,
            query: options.query,
            key: options.key,
            subkey: options.subkey,
            startDate: options.startDate,
            endDate: options.endDate,
          };

          const sqlQuery = filterDef.buildQuery(queryParams);

          this.logger.debug(
            { projectId, field, query: options.query },
            "Executing ClickHouse filter query"
          );

          const result = await this.clickHouseClient.query({
            query: sqlQuery,
            query_params: {
              tenantId: projectId,
              query: options.query ?? "",
              startDate: options.startDate,
              endDate: options.endDate,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json();
          const filterOptions = filterDef.extractResults(rows as unknown[]);

          span.setAttribute("clickhouse.result_count", filterOptions.length);

          this.logger.debug(
            { projectId, field, resultCount: filterOptions.length },
            "Successfully fetched filter options from ClickHouse"
          );

          return filterOptions;
        } catch (error) {
          this.logger.error(
            {
              projectId,
              field,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch filter options from ClickHouse"
          );

          // Return null to trigger Elasticsearch fallback
          span.setAttribute("clickhouse.error", true);
          return null;
        }
      }
    );
  }
}
