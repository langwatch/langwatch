/**
 * The one private persistence capability behind a filter picker.
 *
 * Declared as a port rather than an interface so a deployment without
 * ClickHouse can be handed `null` and refuse at the call — see
 * {@link FilterService} — instead of composing a repository
 * that would fail on its first query.
 */
import type { FilterField } from "@langwatch/analytics-contract";
import type { ClickHouseFilterQueryParams, FilterOption } from "../filters/clickhouse/types";

export interface FindFilterOptionsInput extends ClickHouseFilterQueryParams {
  field: FilterField;
}

export abstract class FilterOptionsPort {
  abstract findOptions(input: FindFilterOptionsInput): Promise<FilterOption[]>;
}
