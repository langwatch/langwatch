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

/** The trace identity every pass orders, pages and restricts by. */
const LWQL_PASS_TRACE_COLUMN = "TraceId";

const SPAN_COLUMN: LangWatchQLPassKeyColumn = "SpanId";

/** One composed pass: the wrapper's text and the values its own parameters take. */
interface LangWatchQLComposedPass {
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

/**
 * One page of row keys, picked on the row ids alone; the other key columns are read only for
 * the page's rows. A map lookup projected over the whole window ran out of memory at the 1 GB cap.
 * @see specs/analytics/clickhouse-memory-safety.feature
 */
function boundedKeys({
  sql,
  keyColumns,
  where,
  limit,
}: {
  sql: string;
  keyColumns: readonly LangWatchQLPassKeyColumn[];
  /** The condition that picks the page, over the alias it is given; absent, every row. */
  where?: (alias: string) => string;
  limit: number;
}): string {
  const page = ({ projection, alias }: { projection: string; alias: string }) =>
    `SELECT ${projection}\nFROM (\n${sql}\n) AS ${alias}` +
    (where === undefined ? "" : `\nWHERE ${where(alias)}`) +
    `\nORDER BY ${rowId({ keyColumns, alias })}\nLIMIT ${limit}`;
  if (keyColumns.every((column) => column === SPAN_COLUMN)) {
    return page({ projection: keyProjection(keyColumns), alias: "q" });
  }
  const ids = page({
    projection: rowIdColumns(keyColumns)
      .map((column) => `k.${column}`)
      .join(", "),
    alias: "k",
  });
  const id = rowId({ keyColumns, alias: "q" });

  return (
    `SELECT ${keyProjection(keyColumns)}\nFROM (\n${sql}\n) AS q` +
    `\nWHERE ${id} IN (\n${ids}\n)\nORDER BY ${id}\nLIMIT ${limit}`
  );
}

function keyProjection(keyColumns: readonly LangWatchQLPassKeyColumn[]): string {
  return [LWQL_PASS_TRACE_COLUMN, ...keyColumns]
    .map((column) => `q.${column} AS ${column}`)
    .join(", ");
}

/** The key pass: one page of keys in order, after the key the previous page ended on. */
function keysPass({
  sql,
  pass,
}: {
  sql: string;
  pass: Extract<LangWatchQLPass, { kind: "keys" }>;
}): LangWatchQLComposedPass {
  const bySpan = pagesBySpan(pass.keyColumns);
  const after = bySpan
    ? `({${LWQL_PASS_AFTER_TRACE_PARAMETER}:String}, {${LWQL_PASS_AFTER_SPAN_PARAMETER}:String})`
    : `{${LWQL_PASS_AFTER_TRACE_PARAMETER}:String}`;

  return {
    sql: boundedKeys({
      sql,
      keyColumns: pass.keyColumns,
      ...(pass.after === undefined
        ? {}
        : {
            where: (alias: string) => `${rowId({ keyColumns: pass.keyColumns, alias })} > ${after}`,
          }),
      limit: pass.limit,
    }),
    parameters:
      pass.after === undefined
        ? {}
        : {
            [LWQL_PASS_AFTER_TRACE_PARAMETER]: pass.after.traceId,
            ...(bySpan ? { [LWQL_PASS_AFTER_SPAN_PARAMETER]: pass.after.spanId ?? "" } : {}),
          },
  };
}

/** A sample spread across the selection by a hash bucket over the whole row key. */
function samplePass({
  sql,
  pass,
}: {
  sql: string;
  pass: Extract<LangWatchQLPass, { kind: "sample" }>;
}): LangWatchQLComposedPass {
  return {
    sql: boundedKeys({
      sql,
      keyColumns: pass.keyColumns,
      where: (alias) =>
        `cityHash64(${rowIdColumns(pass.keyColumns)
          .map((column) => `${alias}.${column}`)
          .join(", ")}) % {${LWQL_PASS_SAMPLE_BUCKET_PARAMETER}:UInt64} = 0`,
      limit: pass.limit,
    }),
    parameters: { [LWQL_PASS_SAMPLE_BUCKET_PARAMETER]: pass.buckets },
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
      return keysPass({ sql, pass });
    case "sample":
      return samplePass({ sql, pass });
    case "page":
      return {
        sql:
          `SELECT * FROM (\n${sql}\n) AS q` +
          `\nWHERE q.${LWQL_PASS_TRACE_COLUMN} IN ` +
          `({${LWQL_HYDRATION_TRACE_IDS_PARAMETER}:Array(String)})` +
          `\nORDER BY q.${LWQL_PASS_TRACE_COLUMN}`,
        parameters: { [LWQL_HYDRATION_TRACE_IDS_PARAMETER]: [...pass.traceIds] },
      };
  }
}
