/**
 * The fixed wrappers a pass runs an accepted statement inside, and the values they bind. The
 * statement goes into a subquery character for character; the wrapper only decides which of its
 * rows come back. @see specs/instant-evals/instant-eval-pipeline.feature
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
export const LWQL_PASS_TRACE_COLUMN = "TraceId";

const SPAN_COLUMN: LangWatchQLPassKeyColumn = "SpanId";

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

function keyProjection(keyColumns: readonly LangWatchQLPassKeyColumn[]): string {
  return [LWQL_PASS_TRACE_COLUMN, ...keyColumns]
    .map((column) => `q.${column} AS ${column}`)
    .join(", ");
}

function keyOrder(keyColumns: readonly LangWatchQLPassKeyColumn[]): string {
  return pagesBySpan(keyColumns)
    ? `(q.${LWQL_PASS_TRACE_COLUMN}, q.${SPAN_COLUMN})`
    : `q.${LWQL_PASS_TRACE_COLUMN}`;
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
  const order = keyOrder(pass.keyColumns);
  const after = bySpan
    ? `({${LWQL_PASS_AFTER_TRACE_PARAMETER}:String}, {${LWQL_PASS_AFTER_SPAN_PARAMETER}:String})`
    : `{${LWQL_PASS_AFTER_TRACE_PARAMETER}:String}`;
  const where = pass.after === undefined ? "" : `\nWHERE ${order} > ${after}`;

  return {
    sql:
      `SELECT ${keyProjection(pass.keyColumns)}\nFROM (\n${sql}\n) AS q${where}` +
      `\nORDER BY ${order}\nLIMIT ${pass.limit}`,
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
  const hashed = pagesBySpan(pass.keyColumns)
    ? `q.${LWQL_PASS_TRACE_COLUMN}, q.${SPAN_COLUMN}`
    : `q.${LWQL_PASS_TRACE_COLUMN}`;

  return {
    sql:
      `SELECT ${keyProjection(pass.keyColumns)}\nFROM (\n${sql}\n) AS q` +
      `\nWHERE cityHash64(${hashed}) % {${LWQL_PASS_SAMPLE_BUCKET_PARAMETER}:UInt64} = 0` +
      `\nORDER BY q.${LWQL_PASS_TRACE_COLUMN}\nLIMIT ${pass.limit}`,
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
