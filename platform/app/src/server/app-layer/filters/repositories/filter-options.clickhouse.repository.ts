import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  buildScopeConditions,
  type ClickHouseFilterQueryParams,
  clickHouseFilters,
  type FilterOption,
  type SupportedClickHouseFilterDefinition,
} from "~/server/filters/clickhouse";
import type { FilterField } from "~/server/filters/types";

const logger = createLogger("langwatch:filters:repository");

export interface FindFilterOptionsInput extends ClickHouseFilterQueryParams {
  field: FilterField;
}

export interface FilterOptionsRepository {
  findOptions(input: FindFilterOptionsInput): Promise<FilterOption[]>;
}

/**
 * Reads the distinct values a filter can offer.
 *
 * The query lives here rather than in the service because a filter's SQL is
 * storage, not policy: which table it reads, how it scopes to the tenant and
 * how its rows decode are all facts about ClickHouse. The service above keeps
 * what is genuinely its own - validating the caller, tracing the call, and
 * deciding that an unsupported field simply has no options.
 */
export class FilterOptionsClickHouseRepository implements FilterOptionsRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async findOptions(input: FindFilterOptionsInput): Promise<FilterOption[]> {
    const definition = this.definitionFor(input.field);
    if (!definition) return [];

    const sql = definition.buildQuery(input);
    // A definition that needs a key or subkey returns null while one is
    // missing: there is nothing to ask for yet, not an empty answer to cache.
    if (sql === null) return [];

    if (!sql.includes("TenantId = {tenantId:String}")) {
      throw new Error(
        `Security: Filter query for ${input.field} is missing TenantId isolation`,
      );
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
