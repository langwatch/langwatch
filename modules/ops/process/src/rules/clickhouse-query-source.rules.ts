/**
 * Where a failed ClickHouse statement came from: the `log_comment` prefix each product read
 * tags its statements with, and the collapse of anything else to `other` (ADR-202).
 */
import { clickHouseQuerySourceSchema, type ClickHouseQuerySource } from "@langwatch/ops-contract";

/** Each tagged source and the `log_comment` prefix that names it, in match order. */
export const CLICKHOUSE_QUERY_SOURCE_PREFIXES: readonly Readonly<{
  source: Exclude<ClickHouseQuerySource, "other">;
  prefix: string;
}>[] = [
  { source: "lwql", prefix: "lwql:" },
  { source: "dashboard", prefix: "analytics:timeseries:" },
  { source: "instant_eval", prefix: "instant_eval:" },
  { source: "trace_list", prefix: "trace_list:" },
  { source: "facet", prefix: "facet:" },
];

/** The SQL expression naming a row's source from its `log_comment`; the prefixes are constants. */
export function querySourceExpression(): string {
  const arms = CLICKHOUSE_QUERY_SOURCE_PREFIXES.map(
    ({ source, prefix }) => `startsWith(log_comment, '${prefix}'), '${source}'`,
  );
  return `multiIf(${arms.join(", ")}, 'other')`;
}

/** A source as storage answered it; a value this release does not know is `other`. */
export function querySourceOf(stored: string): ClickHouseQuerySource {
  return clickHouseQuerySourceSchema.safeParse(stored).data ?? "other";
}

/** The project ids a LangWatchQL group named, without blanks, at most `max`. */
export function projectIdsOf({ ids, max }: { ids: readonly string[]; max: number }): string[] {
  return [...new Set(ids.filter((id) => id !== ""))].toSorted().slice(0, max);
}
