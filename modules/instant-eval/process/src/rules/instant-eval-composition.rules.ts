/**
 * The four statements a run builds around the caller's own, and nothing else:
 * their text goes inside a subquery character for character, and the wrapper
 * only decides which of its rows come back.
 * @see dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md
 */

import type { LangWatchQLColumn } from "@langwatch/analytics-contract";

/** The bound parameter a page pass carries its own trace ids in. */
export const INSTANT_EVAL_PAGE_PARAMETER = "instant_eval_page_ids";

/** The cursor parameters the key pass pages with. */
export const INSTANT_EVAL_AFTER_PARAMETER = "instant_eval_after_trace_id";
export const INSTANT_EVAL_AFTER_SPAN_PARAMETER = "instant_eval_after_span_id";

/** The bucket count a spread sample divides the selection into. */
export const INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER = "instant_eval_buckets";

/**
 * Every parameter name this surface owns. A caller who declares one, or
 * supplies a value for one, is refused: the run would otherwise overwrite
 * their value or be paged by it.
 */
export const INSTANT_EVAL_RESERVED_PARAMETERS = [
  INSTANT_EVAL_PAGE_PARAMETER,
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_AFTER_SPAN_PARAMETER,
  INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER,
] as const;

/** Whether a parameter name belongs to the run rather than to the caller. */
export function isInstantEvalReservedParameter(name: string): boolean {
  return INSTANT_EVAL_RESERVED_PARAMETERS.some((reserved) => reserved === name);
}

/** The column every run's statement has to project, and pages are ordered by. */
export const INSTANT_EVAL_TRACE_COLUMN = "TraceId";

/** The second half of the order, when the statement projects it. */
export const INSTANT_EVAL_SPAN_COLUMN = "SpanId";

/** Columns a run carries onto its judgements when the statement projects them. */
export const INSTANT_EVAL_OPTIONAL_KEY_COLUMNS = [
  "ThreadId",
  INSTANT_EVAL_SPAN_COLUMN,
  "OccurredAt",
] as const;

/** The optional key columns a probe's column list actually offers. */
export function instantEvalKeyColumns(columns: readonly LangWatchQLColumn[]): readonly string[] {
  const present = new Set(columns.map((column) => column.name));

  return INSTANT_EVAL_OPTIONAL_KEY_COLUMNS.filter((column) => present.has(column));
}

/**
 * Whether this statement's rows are addressed by the trace and span pair. A
 * trace is not unique over spans, so ordering by it alone would cut one
 * trace's span rows across a page boundary and skip the rest.
 */
export function instantEvalPagesBySpan(keyColumns: readonly string[]): boolean {
  return keyColumns.includes(INSTANT_EVAL_SPAN_COLUMN);
}

/**
 * The statement, asked what it projects and nothing more. `LIMIT 0` rather
 * than `LIMIT 1`: the column list comes back either way, and reading one row
 * would make a classification before the run has been accepted.
 */
export function instantEvalProbeSql(sql: string): string {
  return `SELECT * FROM (\n${sql}\n) AS q LIMIT 0`;
}

/**
 * How many rows the statement matches, counted one past the limit so a capped
 * run knows it was capped — and bounded inside the database, so a ten-million
 * row selection is not scanned in full to learn that it is over the cap.
 */
export function instantEvalCountSql({
  sql,
  limit,
}: {
  readonly sql: string;
  /** The run's row limit plus one. */
  readonly limit: number;
}): string {
  return (
    `SELECT count() AS total FROM (\n` +
    `SELECT q.${INSTANT_EVAL_TRACE_COLUMN} FROM (\n${sql}\n) AS q LIMIT ${limit}\n` +
    `) AS c`
  );
}

/** The key columns a wrapper selects, each aliased back to its own name. */
function keyProjection(keyColumns: readonly string[]): string {
  return [INSTANT_EVAL_TRACE_COLUMN, ...keyColumns]
    .map((column) => `q.${column} AS ${column}`)
    .join(", ");
}

/**
 * One page of row keys, in order, after the key the previous page ended on.
 * Only the key columns the statement actually projects are named: a statement
 * grouped by conversation has no `SpanId`, and naming it would refuse the run.
 */
export function instantEvalKeyPassSql({
  sql,
  keyColumns,
  limit,
  hasCursor,
}: {
  readonly sql: string;
  /** The optional key columns the probe found, in catalog order. */
  readonly keyColumns: readonly string[];
  readonly limit: number;
  /** Whether the page starts after a previous page's last key. */
  readonly hasCursor: boolean;
}): string {
  const bySpan = instantEvalPagesBySpan(keyColumns);
  const order = bySpan
    ? `(q.${INSTANT_EVAL_TRACE_COLUMN}, q.${INSTANT_EVAL_SPAN_COLUMN})`
    : `q.${INSTANT_EVAL_TRACE_COLUMN}`;
  const after = bySpan
    ? `({${INSTANT_EVAL_AFTER_PARAMETER}:String}, {${INSTANT_EVAL_AFTER_SPAN_PARAMETER}:String})`
    : `{${INSTANT_EVAL_AFTER_PARAMETER}:String}`;
  const where = hasCursor ? `\nWHERE ${order} > ${after}` : "";

  return (
    `SELECT ${keyProjection(keyColumns)}\nFROM (\n${sql}\n) AS q${where}` +
    `\nORDER BY ${order}\nLIMIT ${limit}`
  );
}

/**
 * A sample of the selection's keys, spread across all of it by a hash bucket.
 * A head sample measures the wrong rows where row length tracks the
 * statement's own order, and striding would need the whole key list.
 */
export function instantEvalSampleKeysSql({
  sql,
  keyColumns,
  limit,
}: {
  readonly sql: string;
  /** The optional key columns the probe found, in catalog order. */
  readonly keyColumns: readonly string[];
  readonly limit: number;
}): string {
  // Over the whole row key: hashing the trace alone would put one trace's
  // spans in a bucket together, sampling a few whole traces rather than rows.
  const hashed = instantEvalPagesBySpan(keyColumns)
    ? `q.${INSTANT_EVAL_TRACE_COLUMN}, q.${INSTANT_EVAL_SPAN_COLUMN}`
    : `q.${INSTANT_EVAL_TRACE_COLUMN}`;

  return (
    `SELECT ${keyProjection(keyColumns)}\nFROM (\n${sql}\n) AS q` +
    `\nWHERE cityHash64(${hashed}) % ` +
    `{${INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER}:UInt64} = 0` +
    `\nORDER BY q.${INSTANT_EVAL_TRACE_COLUMN}\nLIMIT ${limit}`
  );
}

/**
 * How many buckets a selection of this size is divided into to sample it. One
 * bucket accepts every row, so a selection larger than the sample always gets
 * at least two — otherwise the `LIMIT` hands back the head order again.
 */
export function instantEvalSampleBuckets({
  total,
  limit,
}: {
  readonly total: number;
  readonly limit: number;
}): number {
  if (total <= limit || limit <= 0) return 1;

  return Math.max(2, Math.floor(total / limit));
}

/**
 * The whole of one page's rows, bound to the trace ids the key pass found. The
 * predicate names the trace alone even for a page keyed by the pair, since a
 * tuple parameter does not serialise: the caller drops the over-fetched rows.
 */
export function instantEvalPagePassSql(sql: string): string {
  return (
    `SELECT * FROM (\n${sql}\n) AS q` +
    `\nWHERE q.${INSTANT_EVAL_TRACE_COLUMN} IN ({${INSTANT_EVAL_PAGE_PARAMETER}:Array(String)})` +
    `\nORDER BY q.${INSTANT_EVAL_TRACE_COLUMN}`
  );
}
