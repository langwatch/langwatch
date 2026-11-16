import {
  type ClickHouseRead,
  type ClickHouseReadStart,
  type Condition,
  cond,
  type ReaderScope,
} from "@langwatch/clickhouse-client/builder";

import type {
  TraceFilterCompilation,
  TraceFilterCondition,
} from "../../features/query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import { traceSummaries as ts } from "./clickhouse.trace-summaries.table.ts";

/** `live: true` (a relative preset) means `to` is rolling: skip the upper bound. */
export function isLiveUpperBound(timeRange: { to: number; live?: boolean }): boolean {
  return timeRange.live === true;
}

/** The window a list read covers on `OccurredAt`; a live range leaves the upper bound open. */
export function occurredWithin(timeRange: {
  from: number;
  to: number;
  live?: boolean;
}): Condition<"trace_summaries"> {
  const from = cond.gte(ts.OccurredAt, timeRange.from);
  return isLiveUpperBound(timeRange) ? from : cond.and(from, cond.lte(ts.OccurredAt, timeRange.to));
}

/** The compiled filter as one term; an empty filter narrows nothing. */
export function filterTerm(filter: TraceFilterCompilation): TraceFilterCondition {
  return filter.kind === "compiled" ? filter.where : () => cond.always();
}

/**
 * The proof's windows and the time range decide the latest-version election; the filter
 * applies after it, or a re-annotated trace answers to both annotation buckets.
 */
export function electedSummaries<S extends ReaderScope>({
  start,
  timeRange,
  filter,
}: {
  start: ClickHouseReadStart<S>;
  timeRange: { from: number; to: number; live?: boolean };
  filter: TraceFilterCompilation;
}): ClickHouseRead<S, "trace_summaries", Record<never, never>, Record<never, never>> {
  return start
    .from(ts)
    .withinWindows()
    .where(() => occurredWithin(timeRange))
    .where(filterTerm(filter), { inElection: false });
}
