import { createLogger } from "@langwatch/observability";
import { getLangWatchTracer } from "langwatch";
import type { FilterParam } from "@langwatch/contracts/filters";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import {
  buildScopeConditions,
  type ClickHouseFilterQueryParams,
  clickHouseFilters,
  type FilterOption,
  type SupportedClickHouseFilterDefinition,
} from "./clickhouse";
import type { FilterField } from "@langwatch/contracts/filters";

export type GetFilterOptionsInput = {
  projectId: string;
  field: FilterField;
  query?: string;
  key?: string;
  subkey?: string;
  startDate: number;
  endDate: number;
  scopeFilters?: Partial<Record<FilterField, FilterParam>>;
};

/**
 * Service for fetching filter options from ClickHouse.
 */
export class FilterService {
  private readonly logger = createLogger("langwatch:filters:service");
  private readonly tracer = getLangWatchTracer("langwatch.filters.service");

  static create(): FilterService {
    return new FilterService();
  }

  private getFilterDefinition(
    field: FilterField,
  ): SupportedClickHouseFilterDefinition | null {
    const filterDef = clickHouseFilters[field];
    if (!filterDef || filterDef.tableName === null) {
      this.logger.debug({ field }, "Filter not supported in ClickHouse");
      return null;
    }
    return filterDef as SupportedClickHouseFilterDefinition;
  }

  async getFilterOptions(
    input: GetFilterOptionsInput,
  ): Promise<FilterOption[]> {
    return await this.tracer.withActiveSpan(
      "FilterService.getFilterOptions",
      {
        attributes: {
          "tenant.id": input.projectId,
          "filter.field": input.field,
        },
      },
      async (span) => {
        if (
          !input.projectId ||
          typeof input.projectId !== "string" ||
          input.projectId.trim() === ""
        ) {
          throw new Error(
            "Security: projectId (tenantId) must be a non-empty string",
          );
        }

        const clickHouseClient = await getClickHouseClientForProject(
          input.projectId,
        );
        if (!clickHouseClient) {
          span.setAttribute("clickhouse.available", false);
          throw new Error(
            "ClickHouse client is not available — check ClickHouse connection configuration",
          );
        }

        const filterDef = this.getFilterDefinition(input.field);
        if (!filterDef) {
          span.setAttribute("clickhouse.filter_supported", false);
          return [];
        }

        span.setAttribute("clickhouse.filter_supported", true);
        span.setAttribute("clickhouse.table", filterDef.tableName);

        try {
          const queryParams: ClickHouseFilterQueryParams = {
            tenantId: input.projectId,
            query: input.query,
            key: input.key,
            subkey: input.subkey,
            startDate: input.startDate,
            endDate: input.endDate,
            scopeFilters: input.scopeFilters,
          };

          const sqlQuery = filterDef.buildQuery(queryParams);

          // Definitions that require a key/subkey return null when it is
          // missing — there is nothing to query yet, so resolve to no options.
          if (sqlQuery === null) {
            span.setAttribute("clickhouse.query_skipped", true);
            return [];
          }

          if (!sqlQuery.includes("TenantId = {tenantId:String}")) {
            throw new Error(
              `Security: Filter query for ${input.field} is missing TenantId isolation`,
            );
          }

          const { params: scopeParams } = buildScopeConditions(queryParams);

          // The UI encodes dots in keys/subkeys as middle dots (·) to avoid path
          // conflicts; convert them back here before parameterising the query.
          const actualKey = input.key?.replaceAll("·", ".") ?? "";
          const actualSubkey = input.subkey?.replaceAll("·", ".") ?? "";

          const result = await clickHouseClient.query({
            query: sqlQuery,
            query_params: {
              tenantId: input.projectId,
              query: input.query ?? "",
              key: actualKey,
              subkey: actualSubkey,
              startDate: input.startDate,
              endDate: input.endDate,
              ...scopeParams,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json();
          const filterOptions = filterDef.extractResults(rows as unknown[]);

          span.setAttribute("clickhouse.result_count", filterOptions.length);
          return filterOptions;
        } catch (error) {
          this.logger.error(
            {
              projectId: input.projectId,
              field: input.field,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch filter options from ClickHouse",
          );
          span.setAttribute("clickhouse.error", true);
          // Do not rethrow the raw ClickHouse error — its message embeds the
          // failing SQL (table/column layout), which tRPC would forward to the
          // browser. Details stay in the server log and span above.
          throw new Error("Failed to fetch filter options");
        }
      },
    );
  }
}
