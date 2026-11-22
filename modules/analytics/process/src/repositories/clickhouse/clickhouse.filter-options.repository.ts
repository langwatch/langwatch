import type { FilterField } from "@langwatch/analytics-contract";
import { AuthorizedClickHouse, type ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

import {
  FilterOptionsRepository,
  type FilterOption,
  type FindFilterOptionsInput,
} from "../filter-options.repository.ts";
import { clickHouseFilters } from "./clickhouse.filter-definitions.mapper.ts";
import { buildScopeConditions } from "./clickhouse.filter-query-helpers.mapper.ts";
import type { SupportedClickHouseFilterDefinition } from "./clickhouse.filter-shapes.mapper.ts";
import { translatingQueryFailures } from "./clickhouse.query-error-translation.mapper.ts";

const logger = createLogger("langwatch:filters:repository");

/**
 * Reads the distinct values a filter can offer, through the route's proof (ADR-177): every
 * definition writes the fence marker, so the reader picks the tenants and refuses a statement
 * that names one by hand.
 */
export class FilterOptionsClickHouseRepository extends FilterOptionsRepository {
  private constructor(private readonly authorized: AuthorizedClickHouse) {
    super();
  }

  static create(options: { clickhouse: ClickHouseQueryClient }): FilterOptionsClickHouseRepository {
    return new FilterOptionsClickHouseRepository(
      new AuthorizedClickHouse({ resolveClient: () => Promise.resolve(options.clickhouse) }),
    );
  }

  async findOptions(input: FindFilterOptionsInput): Promise<FilterOption[]> {
    const definition = this.definitionFor(input.field);
    if (!definition) return [];

    const sql = definition.buildQuery(input);
    // A definition that needs a key or subkey returns null while one is
    // missing: there is nothing to ask for yet, not an empty answer to cache.
    if (sql === null) return [];

    const reader = this.authorized.as(input.authorization, { reads: "analytics" });
    const { params: scopeParams } = buildScopeConditions(input);

    // The UI encodes dots in keys and subkeys as middle dots to keep them out
    // of its path syntax; they go back before the query is parameterised.
    const result = await translatingQueryFailures(() =>
      reader.query({
        query: sql,
        query_params: {
          query: input.query ?? "",
          key: input.key?.replaceAll("·", ".") ?? "",
          subkey: input.subkey?.replaceAll("·", ".") ?? "",
          startDate: input.startDate,
          endDate: input.endDate,
          ...scopeParams,
        },
      }),
    );

    return definition.extractResults(await result.json());
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
