/**
 * How a page's rows are addressed: by the trace and span pair when the
 * statement projects `SpanId`, by the trace alone otherwise.
 * @see modules/instant-eval/specs/instant-eval-pipeline.feature
 */

import { Temporal } from "@langwatch/time";

import {
  INSTANT_EVAL_SPAN_COLUMN,
  INSTANT_EVAL_TRACE_COLUMN,
} from "./instant-eval-composition.rules.ts";

/** One row's identity, as the key pass found it. */
export interface InstantEvalRowKey {
  readonly traceId: string;
  readonly threadId: string;
  readonly spanId: string;
  /** Epoch milliseconds, or null when the statement projects no time column. */
  readonly occurredAt: number | null;
}

/**
 * Where the next page starts. `spanId` is null for a statement whose rows are
 * one per trace, and carries the second half of the order for one whose rows
 * are one per span.
 */
export interface InstantEvalCursor {
  readonly traceId: string;
  readonly spanId: string | null;
}

/** What one page of keys found, and whether more follow it. */
export interface InstantEvalKeyPage {
  readonly keys: readonly InstantEvalRowKey[];
  readonly hasMore: boolean;
}

/**
 * The page's keys, indexed by whatever addresses one of its rows. The same
 * choice keys the judgement row, so a lookup that finds the key and a write
 * that addresses the judgement agree by construction.
 */
export function instantEvalKeyIndex(
  keys: readonly InstantEvalRowKey[],
): ReadonlyMap<string, InstantEvalRowKey> {
  const bySpan = keys.some((key) => key.spanId !== "");

  return new Map(
    keys.map((key) => [bySpan ? rowAddress(key.traceId, key.spanId) : key.traceId, key]),
  );
}

/** One row's address within a page, as a single map key. Neither id holds a pipe. */
function rowAddress(traceId: string, spanId: string): string {
  return `${traceId}|${spanId}`;
}

/** A row's own column, as the text it holds. */
export function instantEvalRowText(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  return typeof value === "string" ? value : "";
}

/**
 * Epoch milliseconds a time column's text carries, or `NaN` when it carries no
 * instant. ClickHouse renders a DateTime without a zone, which is UTC.
 */
function epochMillisecondsOf(text: string): number {
  const zoned = /[Z+-]\d{0,2}:?\d{0,2}$/.test(text.slice(10)) ? text : `${text}Z`;
  try {
    return Temporal.Instant.from(zoned).epochMilliseconds;
  } catch {
    return Number.NaN;
  }
}

/** A row's identity read off its own key columns, as the key pass finds it. */
export function instantEvalRowKeyOf(row: Record<string, unknown>): InstantEvalRowKey {
  const key = {
    traceId: instantEvalRowText(row, INSTANT_EVAL_TRACE_COLUMN),
    threadId: instantEvalRowText(row, "ThreadId"),
    spanId: instantEvalRowText(row, INSTANT_EVAL_SPAN_COLUMN),
  };
  const at = row.OccurredAt;
  if (typeof at === "number") return { ...key, occurredAt: at };
  const text = instantEvalRowText(row, "OccurredAt");
  if (text === "") return { ...key, occurredAt: null };
  const millis = epochMillisecondsOf(text);

  return { ...key, occurredAt: Number.isNaN(millis) ? null : millis };
}

/**
 * The rows of a page read that the page owns. Its predicate names trace ids,
 * so a trace straddling the boundary brings its other span rows along; those
 * belong to the next page and are dropped before anything is paid for.
 */
export function instantEvalOwnedRows({
  rows,
  keys,
}: {
  readonly rows: readonly Record<string, unknown>[];
  readonly keys: readonly InstantEvalRowKey[];
}): readonly Record<string, unknown>[] {
  const keysByRow = instantEvalKeyIndex(keys);

  return rows.filter((row) => findInstantEvalRowKeys({ row, keysByRow }).length > 0);
}

/**
 * The page key a judged row belongs to — at most one, matched by the pair
 * first and the trace alone second. Empty for a row of a page it is not in.
 */
export function findInstantEvalRowKeys({
  row,
  keysByRow,
}: {
  readonly row: Record<string, unknown>;
  readonly keysByRow: ReadonlyMap<string, InstantEvalRowKey>;
}): readonly InstantEvalRowKey[] {
  const traceId = instantEvalRowText(row, INSTANT_EVAL_TRACE_COLUMN);
  const spanId = instantEvalRowText(row, INSTANT_EVAL_SPAN_COLUMN);
  const key = keysByRow.get(rowAddress(traceId, spanId)) ?? keysByRow.get(traceId);

  return key ? [key] : [];
}
