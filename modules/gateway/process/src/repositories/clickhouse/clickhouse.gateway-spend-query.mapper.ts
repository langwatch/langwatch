/**
 * The spend reads' filter predicates and time buckets as builder conditions and expressions over
 * `gateway_spend`. Every caller value is bound; the vocabulary they read lives in the rules.
 */
import {
  type Condition,
  type ConditionOps,
  type Expression,
  fn,
} from "@langwatch/clickhouse-client/builder";
import type { SpendBucket, SpendFilters } from "@langwatch/gateway-contract";

import { normalizeStatusFilter } from "../../rules/gateway-spend-filters.rules.ts";
import { gatewaySpend as spend } from "./clickhouse.gateway-spend.table.ts";

/** One predicate of a spend read, written with that read's own operations. */
export type SpendCondition = <Ctes>(
  ops: ConditionOps<"gateway_spend", Ctes>,
) => Condition<"gateway_spend">;

const IN_COLUMNS = [
  ["virtualKeyIds", spend.VirtualKeyId],
  ["endUserIds", spend.EndUserId],
  ["principalUserIds", spend.PrincipalUserId],
  ["models", spend.Model],
  ["providerKeys", spend.ProviderKey],
  ["requestTypes", spend.RequestType],
] as const satisfies readonly (readonly [
  keyof SpendFilters,
  Expression<string, "gateway_spend">,
])[];

/**
 * One predicate per filter actually present (callers combine them). A present-but-empty filter
 * still emits its predicate: otherwise it hands back the org's entire spend under a narrowing the
 * caller asked for. Metadata keys are bound like every other value.
 */
export function spendFilterConditions({ filters }: { filters: SpendFilters }): SpendCondition[] {
  const conditions: SpendCondition[] = [];

  for (const [field, column] of IN_COLUMNS) {
    const values = filters[field];
    if (values === undefined) continue;
    conditions.push(({ oneOf }) => oneOf(column, values));
  }

  const { labels, metadata } = filters;
  if (labels !== undefined) conditions.push(() => fn.hasAny(spend.Labels, labels));

  for (const filter of metadata ?? []) {
    conditions.push(({ oneOf }) => oneOf(fn.mapGet(spend.MetadataMap, filter.key), filter.values));
  }

  const status = filters.status !== undefined ? normalizeStatusFilter(filters.status) : undefined;
  if (status !== undefined) conditions.push(({ eq }) => eq(spend.Status, status));

  return conditions;
}

/**
 * A time bucket as a sortable string, so one cursor comparison covers every
 * grouping dimension. The offset applies inside ClickHouse, not after — a
 * client-side re-bucket of UTC days can't recover requests on the far side.
 */
export function spendBucketExpression({
  bucket,
  timezone,
}: {
  bucket: Exclude<SpendBucket, "none">;
  timezone: string;
}): Expression<string, "gateway_spend"> {
  const start = bucket === "hour" ? fn.toStartOfHour : fn.toStartOfDay;
  const format = bucket === "hour" ? "%Y-%m-%dT%H:00:00" : "%Y-%m-%d";
  return fn.formatDateTime(start(spend.OccurredAt, { timeZone: timezone }), format, timezone);
}
