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
  // Every output alias must be distinct: a dimension aliased the same as an
  // aggregation (e.g. groupBy:["model"] + an aggregation aliased "model") emits
  // two `AS model` clauses over different expressions — ClickHouse error 179,
  // and an ambiguous GROUP BY. claimAlias() fails closed on any collision.
  const selectParts: string[] = [];
  const groupByAliases: string[] = [];
  const usedAliases = new Set<string>();
  for (const dim of q.groupBy ?? []) {
    // `dim` is an enum key; DIMENSION_COLUMNS[dim] is a developer-authored expr.
    claimAlias(usedAliases, dim);
    selectParts.push(`${DIMENSION_COLUMNS[dim]} AS ${dim}`);
    groupByAliases.push(dim);
  }
  q.aggregations.forEach((agg, i) => {
    const spec = AGGREGATION_OPS[agg.op];
    const columnExpr = agg.column ? METRIC_COLUMNS[agg.column] : "";
    const alias = claimAlias(
      usedAliases,
      agg.alias ?? defaultAlias(agg.op, agg.column, i),
    );
    selectParts.push(`${spec.fn(columnExpr)} AS ${alias}`);
  });

  // ---- WHERE: compiler-injected outer tenant scope + mandatory time bounds --
  // The tenant + time predicates are emitted UNCONDITIONALLY. The optional liqe
  // filter is AND-ed in; its own subqueries carry their own TenantId scope.
  const whereParts = [
    "TenantId = {tenantId:String}",
    "OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})",
    "OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})",
    // trace_summaries is a ReplacingMergeTree(UpdatedAt): a trace keeps
    // un-merged row versions until a background merge collapses them, so a bare
    // scan double-counts on count/sum/avg. Keep only the latest version per
    // trace via the IN-tuple dedup pattern (same as
    // trace-list.clickhouse.repository.ts and the analytics dedupedTraceSummaries).
    // The subquery is itself tenant- and time-scoped, preserving the
    // "every table reference carries TenantId" invariant.
    "(TenantId, TraceId, UpdatedAt) IN (" +
      "SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries " +
      "WHERE TenantId = {tenantId:String} " +
      "AND OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64}) " +
      "AND OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64}) " +
      "GROUP BY TenantId, TraceId)",
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
    // Deterministic ordering: without it, LIMIT drops an arbitrary, run-to-run
    // non-deterministic subset of groups. Order by the group keys so a capped
    // result is stable and reproducible.
    groupByAliases.length ? `ORDER BY ${groupByAliases.join(", ")}` : "",
    `LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { sql, params };
}

/** Register an output alias, failing closed if it collides with an earlier one. */
function claimAlias(used: Set<string>, alias: string): string {
  if (used.has(alias)) {
    throw new Error(
      `Duplicate output alias "${alias}" — every dimension and aggregation must map to a distinct column name`,
    );
  }
  used.add(alias);
  return alias;
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
  const prefixed = /^[a-zA-Z]/.test(safe) ? safe : `agg_${safe}`;
  // Always suffix with the positional index so two aggregations sharing the
  // same op+column (e.g. two `count()`) get distinct aliases — otherwise the
  // emitted SQL carries a duplicate `AS count` and ClickHouse rejects it.
  return `${prefixed}_${index}`;
}
