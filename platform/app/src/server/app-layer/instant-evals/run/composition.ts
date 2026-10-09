/**
 * The four statements a run builds around the caller's own, and nothing else.
 *
 * LangWatchQL never rewrites a submitted statement, and a bound scenario holds
 * it to that: the text in `system.query_log` is the text the caller sent
 * (`specs/analytics/lwql-api.feature`). A job cannot honour that literally and
 * still page, so this module draws the line at **composition**: the caller's
 * text goes inside a subquery, character for character, and the wrapper only
 * decides which of its rows come back. Nothing is parsed, nothing is edited,
 * and no clause of theirs is moved. `/api/v1/query` still runs the text
 * verbatim; only this surface wraps it, which is why the wrapping lives here
 * and not in the query service.
 *
 * Four shapes:
 *
 *  - the **probe**, `LIMIT 0`, which answers what the statement projects
 *    without reading a row or judging anything;
 *  - the **count**, which answers how many rows the statement matches, bounded
 *    one past the run's limit so a capped run knows it was capped;
 *  - the **key pass**, which reads one page of row keys and nothing else;
 *  - the **page pass**, which reads the whole row for one page's keys, and is
 *    where the extraction and eval functions hydrate.
 *
 * ## What a page is ordered by
 *
 * `TraceId` is the one column a run's statement is required to project, so it
 * is always available to order by. It is NOT always unique: a statement over
 * `analytics.spans` projects one row per span, so several rows share a trace.
 * When the statement projects `SpanId` as well, paging therefore orders by the
 * pair and the cursor carries both halves. Ordering by `TraceId` alone there
 * would cut a trace's span rows across a page boundary and the next page,
 * starting at `TraceId > cursor`, would skip the rest of them.
 *
 * ## What determinism a page depends on
 *
 * The caller's statement is executed twice per page, once for the keys and
 * once for the rows, plus once for the count. Each execution is a keyset
 * window over the same statement, so the pages tile the selection only if the
 * statement returns the same rows each time. A statement carrying `LIMIT n`
 * with no `ORDER BY` does not: ClickHouse may return a different n rows per
 * execution. Such a statement is accepted, because refusing it would refuse a
 * legitimate exploratory query, but its pages are not guaranteed to cover one
 * fixed set. Add an `ORDER BY` to a statement with a `LIMIT`.
 *
 * @see ../../../analytics/lwql/lwql.service.ts: the verbatim path
 * @see ../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

/**
 * The bound parameter a page pass carries its own trace ids in.
 *
 * Reserved: a caller whose statement declares it, or whose request supplies a
 * value for it, is refused, because the run would then either overwrite their
 * value or be paged by it.
 */
export const INSTANT_EVAL_PAGE_PARAMETER = "instant_eval_page_ids";

/** The cursor parameters the key pass pages with. Reserved for the same reason. */
export const INSTANT_EVAL_AFTER_PARAMETER = "instant_eval_after_trace_id";
export const INSTANT_EVAL_AFTER_SPAN_PARAMETER = "instant_eval_after_span_id";

/** The bucket count a spread sample divides the selection into. */
export const INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER = "instant_eval_buckets";

/** Every parameter name this surface owns. */
export const INSTANT_EVAL_RESERVED_PARAMETERS = [
  INSTANT_EVAL_PAGE_PARAMETER,
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_AFTER_SPAN_PARAMETER,
  INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER,
] as const;

/** Whether a parameter name belongs to the run rather than to the caller. */
export function isInstantEvalReservedParameter(name: string): boolean {
  return (INSTANT_EVAL_RESERVED_PARAMETERS as readonly string[]).includes(name);
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

/** Whether this statement's rows are addressed by the trace and span pair. */
export function instantEvalPagesBySpan(keyColumns: readonly string[]): boolean {
  return keyColumns.includes(INSTANT_EVAL_SPAN_COLUMN);
}

/**
 * The statement, asked what it projects and nothing more.
 *
 * `LIMIT 0` rather than `LIMIT 1`: the column list comes back either way, and
 * reading one row of a judged statement would make one classification before
 * the run has been accepted.
 */
export function instantEvalProbeSql(sql: string): string {
  return `SELECT * FROM (\n${sql}\n) AS q LIMIT 0`;
}

/**
 * How many rows the statement matches, counted one past the limit.
 *
 * A count rather than a key pass read to its end: a hundred thousand keys is
 * about ten megabytes of JSON, past the executor's own result ceiling, and the
 * ceiling truncates rather than refuses. Counting inside the database returns
 * one row whatever the selection's size, and the inner `LIMIT` keeps the count
 * itself bounded so a ten-million-row selection is not fully scanned to learn
 * that it is over the cap.
 *
 * Pass the run's limit plus one: a total equal to that is a run that was
 * capped, and a total below it is the whole selection.
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

/**
 * One page of row keys, in order, after the key the previous page ended on.
 *
 * Selects the key columns the statement actually projects: a statement grouped
 * by conversation has no `SpanId`, and naming an absent column in the wrapper
 * would refuse the whole run for a column the caller never promised.
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
  const projection = [INSTANT_EVAL_TRACE_COLUMN, ...keyColumns]
    .map((column) => `q.${column} AS ${column}`)
    .join(", ");
  const order = bySpan
    ? `(q.${INSTANT_EVAL_TRACE_COLUMN}, q.${INSTANT_EVAL_SPAN_COLUMN})`
    : `q.${INSTANT_EVAL_TRACE_COLUMN}`;
  const after = bySpan
    ? `({${INSTANT_EVAL_AFTER_PARAMETER}:String}, {${INSTANT_EVAL_AFTER_SPAN_PARAMETER}:String})`
    : `{${INSTANT_EVAL_AFTER_PARAMETER}:String}`;
  const where = hasCursor ? `\nWHERE ${order} > ${after}` : "";
  return (
    `SELECT ${projection}\nFROM (\n${sql}\n) AS q${where}` +
    `\nORDER BY ${order}\nLIMIT ${limit}`
  );
}

/**
 * The whole of one page's rows, bound to the trace ids the key pass found.
 *
 * `SELECT *` keeps every output column the caller aliased, which is what lets
 * the hydration plan recorded against the inner statement address this result:
 * the plan is keyed by alias, and the wrapper renames nothing.
 *
 * The predicate is on `TraceId` alone even when the page is keyed by the trace
 * and span pair, because a tuple bound as a query parameter is not a shape the
 * driver serialises reliably. A trace whose spans straddle the page boundary
 * therefore returns rows the page does not own, and the caller drops them by
 * matching the pair. That over-fetch is what the page's own row ceiling
 * bounds.
 */
/**
 * A sample of the selection's keys, spread evenly across all of it.
 *
 * Why not the first N keys: the key pass returns rows in the statement's own
 * order, so the first fifty of a statement ordered by conversation id are the
 * fifty lowest ids. When row length correlates with that order, and on real
 * data it does, a head sample measures the wrong rows. Measured on a ten
 * thousand conversation selection, the head fifty averaged 231 tokens against
 * the selection's true 1,138, so the price came out five times low.
 *
 * Why a hash bucket rather than every Nth row: striding needs the whole key
 * list, and reading a hundred thousand keys to choose fifty of them is the
 * read the count pass exists to avoid. `cityHash64` over the key spreads the
 * same fifty rows across the selection in one query that returns fifty rows,
 * and it does it uniformly rather than evenly, so a selection whose length
 * varies periodically cannot line up with the stride.
 *
 * The hash is over the whole row key. A statement keyed by the trace and span
 * pair has every span of one trace share a `TraceId`, so hashing that alone
 * would put a trace's spans in one bucket together and the sample would be a
 * few whole traces rather than a spread of rows.
 *
 * The caller's statement is untouched inside the subquery, exactly as the page
 * pass leaves it (ADR-082/084/101): the bucket predicate is the wrapper's.
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
  const projection = [INSTANT_EVAL_TRACE_COLUMN, ...keyColumns]
    .map((column) => `q.${column} AS ${column}`)
    .join(", ");
  const hashed = instantEvalPagesBySpan(keyColumns)
    ? `q.${INSTANT_EVAL_TRACE_COLUMN}, q.${INSTANT_EVAL_SPAN_COLUMN}`
    : `q.${INSTANT_EVAL_TRACE_COLUMN}`;
  return (
    `SELECT ${projection}\nFROM (\n${sql}\n) AS q` +
    `\nWHERE cityHash64(${hashed}) % ` +
    `{${INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER}:UInt64} = 0` +
    `\nORDER BY q.${INSTANT_EVAL_TRACE_COLUMN}\nLIMIT ${limit}`
  );
}

/**
 * How many buckets a selection of this size is divided into to sample it.
 *
 * One in every `total / limit` rows, so a selection of ten thousand sampled
 * fifty at a time draws one row in two hundred. One bucket is the
 * sample-everything case a selection no larger than the sample needs, and it
 * is never used for a larger one: with one bucket the predicate accepts every
 * row and the `LIMIT` hands back the head of the statement's own order, which
 * is the sample this whole statement exists to avoid. So a selection larger
 * than the sample always gets at least two.
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

export function instantEvalPagePassSql(sql: string): string {
  return (
    `SELECT * FROM (\n${sql}\n) AS q` +
    `\nWHERE q.${INSTANT_EVAL_TRACE_COLUMN} IN ({${INSTANT_EVAL_PAGE_PARAMETER}:Array(String)})` +
    `\nORDER BY q.${INSTANT_EVAL_TRACE_COLUMN}`
  );
}
