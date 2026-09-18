/**
 * The one private persistence capability behind a filter picker. Declared as
 * a port so a deployment without ClickHouse can be handed `null` and refuse
 * at the call ({@link FilterService}) instead of failing on its first query.
 */
import type { FilterField } from "@langwatch/analytics-contract";
import type { ClickHouseFilterQueryParams } from "./clickhouse/clickhouse.filter-shapes.mapper.ts";

/** One option a filter picker offers, with how many rows carry it. */
export type FilterOption = {
  field: string;
  label: string;
  count: number;
};

export interface FindFilterOptionsInput extends ClickHouseFilterQueryParams {
  field: FilterField;
}

export abstract class FilterOptions {
  abstract findOptions(input: FindFilterOptionsInput): Promise<FilterOption[]>;
}
