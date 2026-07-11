/**
 * The read-only trace query compiler (SPIKE #5670) — the security-critical core.
 *
 * Composes:
 *   - a THIN single-table aggregation emitter over `trace_summaries` (net-new,
 *     deliberately NOT the analytics `buildTimeseriesQuery`, whose aliased/
 *     JOINed/column-pruned shape would break a spliced liqe fragment — see the
 *     spike research doc, "Reuse seam" and devil's-advocate R1), and
 *   - the already-hardened liqe filter compiler `translateFilterToClickHouse`
 *     for the `filter` field (tenant-scoped subqueries, bound values,
 *     field-allowlisted, complexity-capped).
 *
 * The compiler OWNS the outer-query tenant predicate. In the existing trace-list
 * path that predicate is added by the repository layer, one call site at a time
 * (trace-list.clickhouse.repository.ts `buildWhereClause`); for a general query
 * surface that convention is a footgun, so here the outer `TenantId` predicate
 * is emitted unconditionally by the compiler and the tenant param is bound LAST,
 * making the session tenant structurally un-overridable by any request field or
 * filter param (devil's-advocate R3).
 */

import { translateFilterToClickHouse } from "../filter-to-clickhouse";
import {
  AGGREGATION_OPS,
  DIMENSION_COLUMNS,
  METRIC_COLUMNS,
  type TraceQueryRequest,
  traceQueryRequestSchema,
} from "./schema";

export const DEFAULT_ROW_LIMIT = 1000;
export const MAX_ROW_LIMIT = 10_000;

export interface CompileArgs {
  /** The user-supplied structured request (validated here). */
  request: TraceQueryRequest;
  /**
   * The authenticated caller's authorized tenant. MUST come from the session /
   * RBAC layer, NEVER from the request body. This is the only tenant the
   * emitted SQL can ever read.
   */
  tenantId: string;
  /** Optional caps override (defaults enforce the row ceiling). */
  limits?: { maxRows?: number };
}

export interface CompiledQuery {
  sql: string;
  params: Record<string, unknown>;
}

export function compileTraceQuery({
  request,
  tenantId,
  limits,
}: CompileArgs): CompiledQuery {
  // Validation happens BEFORE any SQL is generated: unknown ops/columns/
  // dimensions and a missing time range all throw here (fail-closed).
  const q = traceQueryRequestSchema.parse(request);

  const maxRows = limits?.maxRows ?? MAX_ROW_LIMIT;
  const limit = Math.min(q.limit ?? DEFAULT_ROW_LIMIT, maxRows);

  // ---- SELECT list: curated dimensions, then allowlisted aggregations -------
  const selectParts: string[] = [];
  const groupByAliases: string[] = [];
  for (const dim of q.groupBy ?? []) {
    // `dim` is an enum key; DIMENSION_COLUMNS[dim] is a developer-authored expr.
    selectParts.push(`${DIMENSION_COLUMNS[dim]} AS ${dim}`);
    groupByAliases.push(dim);
  }
  q.aggregations.forEach((agg, i) => {
    const spec = AGGREGATION_OPS[agg.op];
    const columnExpr = agg.column ? METRIC_COLUMNS[agg.column] : "";
    const alias = agg.alias ?? defaultAlias(agg.op, agg.column, i);
    selectParts.push(`${spec.fn(columnExpr)} AS ${alias}`);
  });

  // ---- WHERE: compiler-injected outer tenant scope + mandatory time bounds --
  // The tenant + time predicates are emitted UNCONDITIONALLY. The optional liqe
  // filter is AND-ed in; its own subqueries carry their own TenantId scope.
  const whereParts = [
    "TenantId = {tenantId:String}",
    "OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})",
    "OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})",
  ];

  const params: Record<string, unknown> = {};

  if (q.filter && q.filter.trim()) {
    const fragment = translateFilterToClickHouse(q.filter, tenantId, {
      from: q.timeRange.from,
      to: q.timeRange.to,
    });
    if (fragment) {
      whereParts.push(`(${fragment.sql})`);
      Object.assign(params, fragment.params);
    }
  }

  // Bind the canonical scope params LAST so nothing the caller supplied — a
  // request field, or a filter param that somehow collided on the name — can
  // override the session tenant or the time window. This is the structural
  // guarantee, not a convention.
  params.tenantId = tenantId;
  params.timeFrom = q.timeRange.from;
  params.timeTo = q.timeRange.to;

  const sql = [
    `SELECT ${selectParts.join(", ")}`,
    "FROM trace_summaries",
    `WHERE ${whereParts.join(" AND ")}`,
    groupByAliases.length ? `GROUP BY ${groupByAliases.join(", ")}` : "",
    `LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { sql, params };
}

function defaultAlias(
  op: string,
  column: string | undefined,
  index: number,
): string {
  const base = column ? `${op}_${column}` : op;
  // `op`/`column` are enum keys (already `[a-zA-Z0-9_]`), but guard anyway so a
  // future non-identifier key can never reach the SQL.
  const safe = base.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z]/.test(safe) ? safe : `agg_${index}`;
}
