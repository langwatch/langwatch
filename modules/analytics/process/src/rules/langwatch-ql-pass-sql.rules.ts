/**
 * The fixed wrappers a pass runs an accepted statement inside, and the values they bind. The
 * statement goes into a subquery character for character; the wrapper only decides which of its
 * rows come back. @see modules/instant-eval/specs/instant-eval-pipeline.feature
 */

import {
  LWQL_HYDRATION_TRACE_IDS_PARAMETER,
  LWQL_PASS_AFTER_SPAN_PARAMETER,
  LWQL_PASS_AFTER_TRACE_PARAMETER,
  LWQL_PASS_SAMPLE_BUCKET_PARAMETER,
  type LangWatchQLPass,
  type LangWatchQLPassKeyColumn,
} from "@langwatch/analytics-contract";

import { clickHouseSqlParser } from "./langwatch-ql-parser.rules.ts";
import { collectNodes } from "./lwql-dedup-floor.rules.ts";

/** The trace identity every pass orders, pages and restricts by. */
const LWQL_PASS_TRACE_COLUMN = "TraceId";

const SPAN_COLUMN: LangWatchQLPassKeyColumn = "SpanId";

/** The parameter a two-step pass's key read takes the page's trace ids in. */
export const LWQL_PASS_TRACE_IDS_PARAMETER = "lwql_pass_trace_ids";

/** That parameter as an argument: to the key read's own filter, and to a trace-ids twin. */
export const LWQL_PASS_TRACE_IDS_ARGUMENT = `{${LWQL_PASS_TRACE_IDS_PARAMETER}:Array(String)}`;

/** A page pass's trace ids as an argument to a trace-ids twin. */
export const LWQL_HYDRATION_TRACE_IDS_ARGUMENT = `{${LWQL_HYDRATION_TRACE_IDS_PARAMETER}:Array(String)}`;

/** One composed pass: the wrapper's text and the values its own parameters take. */
export interface LangWatchQLComposedPass {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/**
 * Whether rows are addressed by the trace and span pair. A trace is not unique over spans, so
 * ordering by it alone would cut one trace's span rows across a page boundary.
 */
function pagesBySpan(keyColumns: readonly LangWatchQLPassKeyColumn[]): boolean {
  return keyColumns.includes(SPAN_COLUMN);
}

/** The trace id, and the span id when rows are spans: what identifies one row of a pass. */
function rowIdColumns(keyColumns: readonly LangWatchQLPassKeyColumn[]): readonly string[] {
  return pagesBySpan(keyColumns) ? [LWQL_PASS_TRACE_COLUMN, SPAN_COLUMN] : [LWQL_PASS_TRACE_COLUMN];
}

/** The row ids as one expression over `alias`: a bare column, or a tuple for spans. */
function rowId({
  keyColumns,
  alias,
}: {
  keyColumns: readonly LangWatchQLPassKeyColumn[];
  alias: string;
}): string {
  const columns = rowIdColumns(keyColumns)
    .map((column) => `${alias}.${column}`)
    .join(", ");
  return pagesBySpan(keyColumns) ? `(${columns})` : columns;
}

/** A key or sample pass: the passes that pick one page of row keys. */
type KeyedPass = Extract<LangWatchQLPass, { kind: "keys" | "sample" }>;

/** What picks a keyed pass's page: a condition over the alias it is given, and its values. */
interface PageSelection {
  /** Absent, every row. */
  readonly where?: (alias: string) => string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** The page condition of a key pass (after the previous page's key) or a sample (a bucket). */
function pageSelection(pass: KeyedPass): PageSelection {
  if (pass.kind === "sample") {
    return {
      where: (alias) =>
        `cityHash64(${rowIdColumns(pass.keyColumns)
          .map((column) => `${alias}.${column}`)
          .join(", ")}) % {${LWQL_PASS_SAMPLE_BUCKET_PARAMETER}:UInt64} = 0`,
      parameters: { [LWQL_PASS_SAMPLE_BUCKET_PARAMETER]: pass.buckets },
    };
  }
  if (pass.after === undefined) return { parameters: {} };
  const bySpan = pagesBySpan(pass.keyColumns);
  const after = bySpan
    ? `({${LWQL_PASS_AFTER_TRACE_PARAMETER}:String}, {${LWQL_PASS_AFTER_SPAN_PARAMETER}:String})`
    : `{${LWQL_PASS_AFTER_TRACE_PARAMETER}:String}`;
  return {
    where: (alias) => `${rowId({ keyColumns: pass.keyColumns, alias })} > ${after}`,
    parameters: {
      [LWQL_PASS_AFTER_TRACE_PARAMETER]: pass.after.traceId,
      ...(bySpan ? { [LWQL_PASS_AFTER_SPAN_PARAMETER]: pass.after.spanId ?? "" } : {}),
    },
  };
}

/** One page of `sql`'s rows under `alias`: the page's condition, in row-id order, to its limit. */
function pagedRead({
  sql,
  pass,
  projection,
  alias,
  where,
}: {
  sql: string;
  pass: KeyedPass;
  projection: string;
  alias: string;
  where: ((alias: string) => string) | undefined;
}): string {
  return (
    `SELECT ${projection}\nFROM (\n${sql}\n) AS ${alias}` +
    (where === undefined ? "" : `\nWHERE ${where(alias)}`) +
    `\nORDER BY ${rowId({ keyColumns: pass.keyColumns, alias })}\nLIMIT ${pass.limit}`
  );
}

/** The page's row ids alone, read under the alias `k`. */
function rowIdsRead({ sql, pass }: { sql: string; pass: KeyedPass }): string {
  return pagedRead({
    sql,
    pass,
    projection: rowIdColumns(pass.keyColumns)
      .map((column) => `k.${column}`)
      .join(", "),
    alias: "k",
    where: pageSelection(pass).where,
  });
}

/**
 * One page of row keys, picked on the row ids alone; the other key columns are read only for
 * the page's rows. A map lookup projected over the whole window ran out of memory at the 1 GB cap.
 * @see specs/analytics/clickhouse-memory-safety.feature
 */
function boundedKeys({ sql, pass }: { sql: string; pass: KeyedPass }): LangWatchQLComposedPass {
  const { where, parameters } = pageSelection(pass);
  if (pass.keyColumns.every((column) => column === SPAN_COLUMN)) {
    return {
      sql: pagedRead({ sql, pass, projection: keyProjection(pass.keyColumns), alias: "q", where }),
      parameters,
    };
  }
  const id = rowId({ keyColumns: pass.keyColumns, alias: "q" });
  return {
    sql:
      `SELECT ${keyProjection(pass.keyColumns)}\nFROM (\n${sql}\n) AS q` +
      `\nWHERE ${id} IN (\n${rowIdsRead({ sql, pass })}\n)\nORDER BY ${id}\nLIMIT ${pass.limit}`,
    parameters,
  };
}

function keyProjection(keyColumns: readonly LangWatchQLPassKeyColumn[]): string {
  return [LWQL_PASS_TRACE_COLUMN, ...keyColumns]
    .map((column) => `q.${column} AS ${column}`)
    .join(", ");
}

/** The columns that identify one row of a keyed pass: the trace, and the span for spans. */
export function langWatchQLPassRowIdColumns(pass: KeyedPass): readonly string[] {
  return rowIdColumns(pass.keyColumns);
}

/**
 * Whether the statement declares the parameter the key step binds the page's traces in, which
 * the key step would overwrite: a parameter node of that name anywhere in its tree. A statement
 * that does not parse counts as declaring it, so it keeps the single read.
 */
export function declaresPassTraceIdsParameter(sql: string): boolean {
  const parsed = clickHouseSqlParser.parse(sql);
  if (!parsed.ok) return true;
  const declared = collectNodes(
    parsed.statements,
    (node) => node.type === "QueryParameter" && node.name === LWQL_PASS_TRACE_IDS_PARAMETER,
  );
  return declared.length > 0;
}

/**
 * Whether a pass reads its keys in two steps, the page's row ids and then its key columns for
 * those traces alone: a key or sample pass that projects a key column beyond the ids.
 */
export function readsKeysByTraceIds(pass: LangWatchQLPass): pass is KeyedPass {
  return (
    (pass.kind === "keys" || pass.kind === "sample") &&
    pass.keyColumns.some((column) => column !== SPAN_COLUMN)
  );
}

/** Step one of a two-step pass: the page's row ids, `TraceId` (and `SpanId` for spans). */
export function langWatchQLPassRowIdsSql({
  sql,
  pass,
}: {
  sql: string;
  pass: KeyedPass;
}): LangWatchQLComposedPass {
  return { sql: rowIdsRead({ sql, pass }), parameters: pageSelection(pass).parameters };
}

/**
 * Step two: the page's keys, read only over the traces step one returned. Exact: a further row
 * of those traces that meets the page's condition sorts after the page's last row.
 * `sql` may read a trace-ids twin cut by {@link LWQL_PASS_TRACE_IDS_PARAMETER}.
 */
export function langWatchQLPassKeysOfTracesSql({
  sql,
  pass,
  traceIds,
}: {
  sql: string;
  pass: KeyedPass;
  traceIds: readonly string[];
}): LangWatchQLComposedPass {
  const selection = pageSelection(pass);
  const inTraces = (alias: string) =>
    `${alias}.${LWQL_PASS_TRACE_COLUMN} IN (${LWQL_PASS_TRACE_IDS_ARGUMENT})`;
  const where = (alias: string) =>
    selection.where === undefined
      ? inTraces(alias)
      : `${selection.where(alias)} AND ${inTraces(alias)}`;
  return {
    sql: pagedRead({ sql, pass, projection: keyProjection(pass.keyColumns), alias: "q", where }),
    parameters: { ...selection.parameters, [LWQL_PASS_TRACE_IDS_PARAMETER]: [...traceIds] },
  };
}

/**
 * The wrapper a pass names, around the statement. A page restricts by the trace alone even for
 * a selection keyed by the pair, since a tuple parameter does not serialise.
 */
export function langWatchQLPassSql({
  sql,
  pass,
}: {
  sql: string;
  pass: LangWatchQLPass;
}): LangWatchQLComposedPass {
  switch (pass.kind) {
    case "probe":
      return { sql: `SELECT * FROM (\n${sql}\n) AS q LIMIT 0`, parameters: {} };
    case "count":
      return {
        sql:
          `SELECT count() AS total FROM (\n` +
          `SELECT q.${LWQL_PASS_TRACE_COLUMN} FROM (\n${sql}\n) AS q LIMIT ${pass.limit}\n) AS c`,
        parameters: {},
      };
    case "keys":
    case "sample":
      return boundedKeys({ sql, pass });
    case "page":
      return {
        sql:
          `SELECT * FROM (\n${sql}\n) AS q` +
          `\nWHERE q.${LWQL_PASS_TRACE_COLUMN} IN (${LWQL_HYDRATION_TRACE_IDS_ARGUMENT})` +
          `\nORDER BY q.${LWQL_PASS_TRACE_COLUMN}`,
        parameters: { [LWQL_HYDRATION_TRACE_IDS_PARAMETER]: [...pass.traceIds] },
      };
  }
}
