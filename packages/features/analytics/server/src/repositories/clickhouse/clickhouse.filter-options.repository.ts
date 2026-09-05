import type { ClickHouseClient } from "@clickhouse/client";
import type { FilterField } from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";
import { clickHouseFilters } from "../../filters/clickhouse/filter-definitions";
import { buildScopeConditions } from "../../filters/clickhouse/query-helpers";
import type { SupportedClickHouseFilterDefinition } from "../../filters/clickhouse/types";
import {
  FilterOptionsPort,
  type FilterOption,
  type FindFilterOptionsInput,
} from "../../ports/filter-options.port";

/** How this repository reaches the tenant's ClickHouse client. */
export type ClickHouseClientResolver = (tenantId: string) => Promise<ClickHouseClient>;

const logger = createLogger("langwatch:filters:repository");

/**
 * Reads the distinct values a filter can offer.
 */
export class FilterOptionsClickHouseRepository extends FilterOptionsPort {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {
    super();
  }

  static create(options: {
    resolveClient: ClickHouseClientResolver;
  }): FilterOptionsClickHouseRepository {
    return new FilterOptionsClickHouseRepository(options.resolveClient);
  }

  async findOptions(input: FindFilterOptionsInput): Promise<FilterOption[]> {
    const definition = this.definitionFor(input.field);
    if (!definition) return [];

    const sql = definition.buildQuery(input);
    // A definition that needs a key or subkey returns null while one is
    // missing: there is nothing to ask for yet, not an empty answer to cache.
    if (sql === null) return [];

    if (!sql.includes("TenantId = {tenantId:String}")) {
      throw new Error(`Security: Filter query for ${input.field} is missing TenantId isolation`);
    }

    const client = await this.resolveClient(input.tenantId);
    const { params: scopeParams } = buildScopeConditions(input);

    // The UI encodes dots in keys and subkeys as middle dots to keep them out
    // of its path syntax; they go back before the query is parameterised.
    const result = await client.query({
      query: sql,
      query_params: {
        tenantId: input.tenantId,
        query: input.query ?? "",
        key: input.key?.replaceAll("·", ".") ?? "",
        subkey: input.subkey?.replaceAll("·", ".") ?? "",
        startDate: input.startDate,
        endDate: input.endDate,
        ...scopeParams,
      },
      format: "JSONEachRow",
    });

    return definition.extractResults((await result.json()) as unknown[]);
  }

  private definitionFor(field: FilterField): SupportedClickHouseFilterDefinition | null {
    const definition = clickHouseFilters[field];
    if (!definition || definition.tableName === null) {
      logger.debug({ field }, "Filter not supported in ClickHouse");
      return null;
    }
    return definition as SupportedClickHouseFilterDefinition;
  }
}
