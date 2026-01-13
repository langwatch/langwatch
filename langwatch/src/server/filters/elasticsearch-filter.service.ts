import type { AggregationsAggregationContainer } from "@elastic/elasticsearch/lib/api/typesWithBodyKey";
import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import { createLogger } from "~/utils/logger";
import { availableFilters } from "./registry";
import type { FilterField } from "./types";

export type FilterOption = {
  field: string;
  label: string;
  count: number;
};

export type GetFilterOptionsInput = {
  projectId: string;
  field: FilterField;
  query?: string;
  key?: string;
  subkey?: string;
  startDate: number;
  endDate: number;
  pivotIndexConditions: any;
};

/**
 * Service for fetching filter options from Elasticsearch.
 *
 * This service uses Elasticsearch aggregations to fetch unique values
 * for filter fields based on the definitions in the filter registry.
 */
export class ElasticsearchFilterService {
  private readonly logger = createLogger("langwatch:filters:elasticsearch-service");
  private readonly tracer = getLangWatchTracer(
    "langwatch.filters.elasticsearch-service"
  );

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Static factory method for creating ElasticsearchFilterService with default dependencies.
   */
  static create(prisma: PrismaClient = defaultPrisma): ElasticsearchFilterService {
    return new ElasticsearchFilterService(prisma);
  }

  /**
   * Get filter options for a specific filter field using Elasticsearch aggregations.
   *
   * @param input - Query parameters including project ID, field, and filters
   * @returns Array of filter options with field, label, and count
   */
  async getFilterOptions(input: GetFilterOptionsInput): Promise<FilterOption[]> {
    return await this.tracer.withActiveSpan(
      "ElasticsearchFilterService.getFilterOptions",
      {
        attributes: {
          "tenant.id": input.projectId,
          "filter.field": input.field,
        },
      },
      async (span) => {
        const { projectId, field, query, key, subkey, startDate, pivotIndexConditions } = input;

        this.logger.debug(
          { projectId, field, query },
          "Executing Elasticsearch filter aggregation"
        );

        const client = await esClient({ projectId });
        const response = await client.search({
          index: TRACE_INDEX.for(startDate),
          body: {
            size: 0,
            query: pivotIndexConditions,
            aggs: availableFilters[field].listMatch.aggregation(
              query,
              key,
              subkey
            ) as Record<string, AggregationsAggregationContainer>,
          },
        });

        const results = availableFilters[field].listMatch.extract(
          (response.aggregations ?? {}) as any
        );

        span.setAttribute("elasticsearch.result_count", results.length);

        this.logger.debug(
          { projectId, field, resultCount: results.length },
          "Successfully fetched filter options from Elasticsearch"
        );

        return results;
      }
    );
  }
}
