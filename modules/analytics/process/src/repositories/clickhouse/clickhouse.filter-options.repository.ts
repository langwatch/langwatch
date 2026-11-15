import type { FilterField } from "@langwatch/analytics-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { tenantScope } from "@langwatch/clickhouse-client/builder";
import { createLogger } from "@langwatch/observability";

import {
  FilterOptionsRepository,
  type FilterOption,
  type FindFilterOptionsInput,
} from "../filter-options.repository.ts";
import { clickHouseFilters } from "./clickhouse.filter-definitions.mapper.ts";
import type { SupportedClickHouseFilterDefinition } from "./clickhouse.filter-shapes.mapper.ts";
import { translatingQueryFailures } from "./clickhouse.query-error-translation.mapper.ts";

const logger = createLogger("langwatch:filters:repository");

/** The UI writes a dot in a key or subkey as a middle dot to keep it out of its path syntax. */
const undotted = (value: string | undefined) => value?.replaceAll("·", ".");

/**
 * Reads the distinct values a filter can offer, built under the route's proof (ADR-202): the
 * reader picks the tenants from the proof's fence, and its windows bound every table read.
 */
export class FilterOptionsClickHouseRepository extends FilterOptionsRepository {
  private constructor(private readonly clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
  }

  static create(options: {
    clickhouse: Pick<ClickHouseQueryClient, "read">;
  }): FilterOptionsClickHouseRepository {
    return new FilterOptionsClickHouseRepository(options.clickhouse);
  }

  async findOptions(input: FindFilterOptionsInput): Promise<FilterOption[]> {
    const definition = this.definitionFor(input.field);
    if (!definition) return [];

    const { key, subkey, authorization, ...params } = input;
    const statement = definition.buildQuery({
      ...params,
      ...(key === undefined ? {} : { key: undotted(key) }),
      ...(subkey === undefined ? {} : { subkey: undotted(subkey) }),
      scope: tenantScope.fromProof({ authorization, reads: "analytics" }),
    });
    // A definition that needs a key or subkey returns null while one is
    // missing: there is nothing to ask for yet, not an empty answer to cache.
    if (statement === null) return [];

    const { rows } = await translatingQueryFailures(() => this.clickhouse.read({ statement }));
    return definition.extractResults(rows);
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
