/**
 * Shared pieces of the queryBuilder facets' built reads in this folder.
 */
import {
  type ClickHouseTable,
  clickhouseRead,
  type Condition,
  cond,
  type DerivedColumns,
  type Expression,
  fn,
  type ProofScope,
} from "@langwatch/clickhouse-client/builder";

import type { FacetQuery, FacetQueryContext } from "../../rules/trace-facet-registry.rules.ts";
import { FACET_SETTINGS } from "./clickhouse.trace-facet-scope.mapper.ts";

/**
 * The facet caps, with a spill threshold for the high-cardinality key-discovery reads, and the
 * map functions read from their subcolumns (`mapKeys(m)` as `m.keys`), never the values side.
 */
export const KEY_DISCOVERY_SETTINGS = {
  ...FACET_SETTINGS,
  max_bytes_before_external_group_by: 512 * 1024 * 1024,
  optimize_functions_to_subcolumns: 1,
} as const;

export class ClickHouseTraceFacetQueryRepository {
  private constructor() {}

  static create(): ClickHouseTraceFacetQueryRepository {
    return new ClickHouseTraceFacetQueryRepository();
  }

  /** `value` in lower case starts with the prefix; no prefix matches every value. */
  prefixed<T extends string>(
    value: Expression<string | null, T>,
    prefix: string | undefined,
  ): Condition<T> {
    return prefix ? fn.ilike(fn.lower(value), `${prefix}%`) : cond.always();
  }

  /**
   * Each value of one column, counted, most frequent first, with how many distinct values pass
   * `where` and the prefix.
   */
  countedValues<Name extends string, Columns extends Record<string, unknown>>({
    scope,
    rows,
    value,
    where,
    ctx,
    settings = KEY_DISCOVERY_SETTINGS,
  }: {
    scope: ProofScope;
    rows: ClickHouseTable<Name, DerivedColumns<Columns>, "derived">;
    value: Expression<string, Name>;
    where: Condition<Name>;
    ctx: FacetQueryContext;
    settings?: Readonly<Record<string, number | string>>;
  }): FacetQuery {
    return clickhouseRead({ scope })
      .from(rows)
      .where(() => cond.and(where, this.prefixed(value, ctx.prefix)))
      .select({ facet_value: value, cnt: fn.count(), total_distinct: fn.over(fn.count(), {}) })
      .groupBy(value)
      .orderBy("cnt", "DESC")
      .limit(ctx.limit)
      .offset(ctx.offset)
      .settings(settings)
      .build();
  }
}
