/**
 * The names a run's reads bind and the key columns it pages by. The wrappers
 * themselves are Analytics' to compose, around the statement it re-validates.
 * @see dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md
 */

import {
  LWQL_PASS_AFTER_SPAN_PARAMETER,
  LWQL_PASS_AFTER_TRACE_PARAMETER,
  LWQL_PASS_KEY_COLUMNS,
  LWQL_PASS_SAMPLE_BUCKET_PARAMETER,
  type LangWatchQLColumn,
  type LangWatchQLPassKeyColumn,
} from "@langwatch/analytics-contract";

/** The bound parameter a page pass carries its own trace ids in. */
export const INSTANT_EVAL_PAGE_PARAMETER = "instant_eval_page_ids";

/**
 * Every parameter name this surface owns. A caller who declares one, or
 * supplies a value for one, is refused: the run would otherwise overwrite
 * their value or be paged by it.
 */
export const INSTANT_EVAL_RESERVED_PARAMETERS = [
  INSTANT_EVAL_PAGE_PARAMETER,
  LWQL_PASS_AFTER_TRACE_PARAMETER,
  LWQL_PASS_AFTER_SPAN_PARAMETER,
  LWQL_PASS_SAMPLE_BUCKET_PARAMETER,
] as const;

/** Whether a parameter name belongs to the run rather than to the caller. */
export function isInstantEvalReservedParameter(name: string): boolean {
  return INSTANT_EVAL_RESERVED_PARAMETERS.some((reserved) => reserved === name);
}

/** The column every run's statement has to project, and pages are ordered by. */
export const INSTANT_EVAL_TRACE_COLUMN = "TraceId";

/** The second half of the order, when the statement projects it. */
export const INSTANT_EVAL_SPAN_COLUMN = "SpanId";

/** The optional key columns a probe's column list actually offers. */
export function instantEvalKeyColumns(
  columns: readonly LangWatchQLColumn[],
): readonly LangWatchQLPassKeyColumn[] {
  const present = new Set(columns.map((column) => column.name));

  return LWQL_PASS_KEY_COLUMNS.filter((column) => present.has(column));
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
