/**
 * The reads a filter picker starts from, built on the typed builder (ADR-202): each table in the
 * picker's window under the route proof's scope, narrowed by the other filters through analytics'
 * own translator (Decided 26), matched on tenant as well as trace.
 */
import {
  type ClickHouseRead,
  type ClickHouseReadStart,
  clickhouseRead,
  type Condition,
  type Expression,
  fn,
  type ProofScope,
} from "@langwatch/clickhouse-client/builder";

import type { FilterOption } from "../filter-options.repository.ts";
import { evaluationRuns } from "./clickhouse.evaluation-runs.table.ts";
import {
  analyticsFilterCondition,
  filterTranslations,
} from "./clickhouse.filter-conditions.mapper.ts";
import type { FilterOptionsReadInput } from "./clickhouse.filter-shapes.mapper.ts";
import { storedSpans } from "./clickhouse.stored-spans.table.ts";
import { traceSummaries } from "./clickhouse.trace-summaries.table.ts";

/** A picker's read from one table under the proof, before its selection. */
type PickerRead<Table extends string> = ClickHouseRead<
  ProofScope,
  Table,
  Record<never, never>,
  Record<never, never>
>;

/** The most options a picker lists. */
export const PICKER_LIMIT = 10000;

/**
 * Attribute keys as stored in ClickHouse trace_summaries.Attributes map. These must match the
 * canonical keys the trace summary fold projection writes.
 */
export const ATTRIBUTE_KEYS = {
  thread_id: "gen_ai.conversation.id",
  user_id: "langwatch.user_id",
  customer_id: "langwatch.customer_id",
} as const;

/** Whether any other filter narrows the picker; a flag naming both values does not. */
function narrowed(input: FilterOptionsReadInput): boolean {
  return filterTranslations({ filters: input.filters ?? {}, ts: traceSummaries }).length > 0;
}

/** trace_summaries in the window and the proof's windows, narrowed by the other filters. */
function summariesFrom<Ctes extends Record<string, unknown>>({
  start,
  input,
}: {
  start: ClickHouseReadStart<ProofScope, Ctes>;
  input: FilterOptionsReadInput;
}) {
  const ts = traceSummaries;
  const read = start
    .from(ts)
    .withinWindows()
    .where(({ and, gte, lte }) =>
      and(gte(ts.OccurredAt, input.startDate), lte(ts.OccurredAt, input.endDate)),
    );
  if (!narrowed(input)) return read;
  return read.where(
    analyticsFilterCondition({
      filters: input.filters ?? {},
      ts,
      spanWindow: { startMs: input.startDate, endMs: input.endDate },
    }),
  );
}

/** The `(TenantId, TraceId)` of the traces a picker's other filters keep. */
function pickedTraces<Ctes extends Record<string, unknown>>({
  sub,
  input,
}: {
  sub: ClickHouseReadStart<ProofScope, Ctes>;
  input: FilterOptionsReadInput;
}) {
  return summariesFrom({ start: sub, input }).select({
    TenantId: traceSummaries.TenantId,
    TraceId: traceSummaries.TraceId,
  });
}

/** A trace_summaries picker's rows. */
export function pickerSummaries(input: FilterOptionsReadInput): PickerRead<"trace_summaries"> {
  return summariesFrom({ start: clickhouseRead({ scope: input.scope }), input });
}

/** A stored_spans picker's rows, held to the traces the other filters pick when any do. */
export function pickerSpans(input: FilterOptionsReadInput): PickerRead<"stored_spans"> {
  const ss = storedSpans;
  const read = clickhouseRead({ scope: input.scope })
    .from(ss)
    .withinWindows()
    .where(({ and, gte, lte }) =>
      and(gte(ss.StartTime, input.startDate), lte(ss.StartTime, input.endDate)),
    );
  if (!narrowed(input)) return read;
  return read.where((ops) =>
    ops.within(fn.tuple(ss.TenantId, ss.TraceId), (sub) => pickedTraces({ sub, input })),
  );
}

/**
 * An evaluation_runs picker's rows. An evaluation is timed when it ran, so on an aggregate it is
 * also held to its trace being inside the member's window: a trace from before the share,
 * evaluated after it, stays out (ADR-177 v4.15).
 */
export function pickerEvaluations(input: FilterOptionsReadInput): PickerRead<"evaluation_runs"> {
  const runs = evaluationRuns;
  const read = clickhouseRead({ scope: input.scope })
    .from(runs)
    .withinWindows()
    .where(({ and, gte, lte }) =>
      and(gte(runs.ScheduledAt, input.startDate), lte(runs.ScheduledAt, input.endDate)),
    );
  if (!input.readsMembers && !narrowed(input)) return read;
  return read.where((ops) =>
    ops.within(fn.tuple(runs.TenantId, runs.TraceId), (sub) => pickedTraces({ sub, input })),
  );
}

/** `lower(of) LIKE lower(concat(query, '%'))`, the picker's prefix search as main wrote it. */
export function startsLike<T extends string>(
  of: Expression<string | null, T>,
  query: string,
): Condition<T> {
  return fn.like(fn.lower(of), fn.lower(fn.concat(query, "%")));
}

/**
 * Standard result extractor for field/label/count rows.
 */
export function extractStandardResults(rows: unknown[]): FilterOption[] {
  return (rows as { field: string; label: string; count: string | number }[]).map((row) => ({
    field: row.field,
    label: row.label,
    count: parseInt(String(row.count), 10),
  }));
}
