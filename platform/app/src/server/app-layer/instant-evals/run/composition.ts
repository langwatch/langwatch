/**
 * The three statements a run builds around the caller's own, and nothing else.
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
 * Three shapes:
 *
 *  - the **probe**, `LIMIT 0`, which answers what the statement projects
 *    without reading a row or judging anything;
 *  - the **key pass**, which reads one page of trace ids and nothing else, so a
 *    run knows its size before it spends anything;
 *  - the **page pass**, which reads the whole row for one page's ids, and is
 *    where the extraction and eval functions hydrate.
 *
 * Paging orders by `TraceId`. It is the one column a run's statement is
 * required to project, it is unique per judged row, and it therefore gives a
 * total order with no second column to agree on. A page is `TraceId > <last
 * id>`, which is deterministic across retries: the same page number always
 * covers the same ids, whoever runs it.
 *
 * @see ../../../analytics/lwql/lwql.service.ts: the verbatim path
 * @see ../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

/**
 * The bound parameter a page pass carries its own ids in.
 *
 * Reserved: a caller whose statement declares it, or whose request supplies a
 * value for it, is refused, because the run would then either overwrite their
 * value or be paged by it.
 */
export const INSTANT_EVAL_PAGE_PARAMETER = "instant_eval_page_ids";

/** The cursor parameter the key pass pages with. Reserved for the same reason. */
export const INSTANT_EVAL_AFTER_PARAMETER = "instant_eval_after_trace_id";

/** Every parameter name this surface owns. */
export const INSTANT_EVAL_RESERVED_PARAMETERS = [
  INSTANT_EVAL_PAGE_PARAMETER,
  INSTANT_EVAL_AFTER_PARAMETER,
] as const;

/** Whether a parameter name belongs to the run rather than to the caller. */
export function isInstantEvalReservedParameter(name: string): boolean {
  return (INSTANT_EVAL_RESERVED_PARAMETERS as readonly string[]).includes(name);
}

/** The column every run's statement has to project, and pages are ordered by. */
export const INSTANT_EVAL_TRACE_COLUMN = "TraceId";

/** Columns a run carries onto its judgements when the statement projects them. */
export const INSTANT_EVAL_OPTIONAL_KEY_COLUMNS = [
  "ThreadId",
  "SpanId",
  "OccurredAt",
] as const;

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
 * One page of trace ids, in order, after the id the previous page ended on.
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
  /** Whether the page starts after a previous page's last id. */
  readonly hasCursor: boolean;
}): string {
  const projection = [INSTANT_EVAL_TRACE_COLUMN, ...keyColumns]
    .map((column) => `q.${column} AS ${column}`)
    .join(", ");
  const where = hasCursor
    ? `\nWHERE q.${INSTANT_EVAL_TRACE_COLUMN} > {${INSTANT_EVAL_AFTER_PARAMETER}:String}`
    : "";
  return (
    `SELECT ${projection}\nFROM (\n${sql}\n) AS q${where}` +
    `\nORDER BY q.${INSTANT_EVAL_TRACE_COLUMN}\nLIMIT ${limit}`
  );
}

/**
 * The whole of one page's rows, bound to the ids the key pass found.
 *
 * `SELECT *` keeps every output column the caller aliased, which is what lets
 * the hydration plan recorded against the inner statement address this result:
 * the plan is keyed by alias, and the wrapper renames nothing.
 */
export function instantEvalPagePassSql(sql: string): string {
  return (
    `SELECT * FROM (\n${sql}\n) AS q` +
    `\nWHERE q.${INSTANT_EVAL_TRACE_COLUMN} IN ({${INSTANT_EVAL_PAGE_PARAMETER}:Array(String)})` +
    `\nORDER BY q.${INSTANT_EVAL_TRACE_COLUMN}`
  );
}
