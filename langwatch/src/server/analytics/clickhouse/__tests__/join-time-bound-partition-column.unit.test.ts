import { describe, expect, it } from "vitest";
import { TIME_PARTITIONED_TABLES } from "~/server/app-layer/clients/clickhouse/cold-scan-detector";
import type { FilterField } from "../../../filters/types";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import type { AggregationTypes } from "../../types";
import {
  buildDataForFilterQuery,
  buildTimeseriesQuery,
} from "../aggregation-builder";
import { resetParamCounter } from "../filter-translator";

/**
 * Every table subquery the analytics builders emit sits inside a query over
 * `trace_summaries`. ClickHouse resolves an identifier the inner table does not
 * have against the OUTER scope rather than failing, so a range bound naming the
 * wrong column silently becomes a correlated reference to `trace_summaries`.
 * That is accepted in a plain read and only rejected once it lands inside an
 * `IN`, at query time, with "Correlated subqueries are not supported as IN
 * function arguments yet", so the mistake reaches production as a 500 on every
 * evaluation graph rather than as a build or typecheck error.
 *
 * A range bound therefore has to name the bounded table's own partition column.
 * {@link TIME_PARTITIONED_TABLES} holds those, and is itself kept honest against
 * the migrations by `cold-scan-detector.coverage.unit.test.ts`.
 */

const RANGE_BOUND_OR_TABLE =
  /\bFROM\s+([a-zA-Z_]\w*)|(?<![\w.`])(?:([a-zA-Z_]\w*)\.)?([a-zA-Z_]\w*)\s*(?:>=|<=|>|<)\s*\{/g;

/**
 * Columns a table was partitioned by before the current DDL, which long-lived
 * deployments still run on. A bound on one prunes nothing on the unified schema
 * but is what makes the subquery prune on those installs, so it is allowed
 * here. It does NOT belong in {@link TIME_PARTITIONED_TABLES}: that map tells
 * the cold-scan detector which predicate is enough to prune today, and a legacy
 * column there would clear the flag on queries that still scan everything.
 */
const LEGACY_PARTITION_COLUMNS: Record<string, readonly string[]> = {
  evaluation_runs: ["UpdatedAt"],
};

/**
 * The table a bound belongs to: its qualifier when that names a table, the
 * enclosing `FROM` when the bound is bare, and nothing when the qualifier is an
 * alias of the outer query.
 */
function boundedTable(
  qualifier: string | undefined,
  enclosingTable: string | null,
  knownTables: ReadonlySet<string>,
): string | null {
  if (!qualifier) return enclosingTable;
  return knownTables.has(qualifier) ? qualifier : null;
}

/**
 * Range bounds in `sql`, grouped by the table they bound.
 *
 * A bare identifier belongs to the nearest preceding `FROM <table>` — that is
 * the scope ClickHouse would resolve it in, or fail to. A qualified one belongs
 * to its qualifier when the qualifier names a table, since qualifying pins the
 * reference to that table's own column; any other qualifier is an alias of the
 * outer query and is skipped.
 */
function rangeBoundColumnsByTable(sql: string): Map<string, Set<string>> {
  const knownTables = new Set(Object.keys(TIME_PARTITIONED_TABLES));
  const byTable = new Map<string, Set<string>>();
  let enclosingTable: string | null = null;

  RANGE_BOUND_OR_TABLE.lastIndex = 0;
  let match: RegExpExecArray | null = RANGE_BOUND_OR_TABLE.exec(sql);
  while (match !== null) {
    const [, fromTable, qualifier, column] = match;
    if (fromTable) {
      enclosingTable = fromTable;
    }
    const table =
      fromTable || !column
        ? null
        : boundedTable(qualifier, enclosingTable, knownTables);
    if (table && column) {
      const columns = byTable.get(table) ?? new Set<string>();
      columns.add(column);
      byTable.set(table, columns);
    }
    match = RANGE_BOUND_OR_TABLE.exec(sql);
  }

  return byTable;
}

/** One message per bound that names a column the table cannot prune on. */
function partitionBoundViolations(sql: string): string[] {
  const violations: string[] = [];

  for (const [table, columns] of rangeBoundColumnsByTable(sql)) {
    const partitionColumns = (
      TIME_PARTITIONED_TABLES as Record<string, readonly string[] | undefined>
    )[table];
    if (!partitionColumns) continue;

    const prunable = [
      ...partitionColumns,
      ...(LEGACY_PARTITION_COLUMNS[table] ?? []),
    ];

    for (const column of columns) {
      if (prunable.includes(column)) continue;
      violations.push(
        `${table} is bounded on ${column}, which is none of the columns it can prune on (${prunable.join(", ")}); ClickHouse resolves an unqualified ${column} against the outer trace_summaries scope instead of failing`,
      );
    }
  }

  return violations;
}

const baseInput = {
  projectId: "partition-bound-guard",
  startDate: new Date("2025-01-01T00:00:00Z"),
  endDate: new Date("2025-02-01T00:00:00Z"),
  previousPeriodStartDate: new Date("2024-12-01T00:00:00Z"),
} as const;

const COST_SERIES = {
  metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
  aggregation: "sum" as AggregationTypes,
} as const;
const EVAL_SERIES = {
  metric: "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum,
  aggregation: "avg" as AggregationTypes,
  key: "some-evaluator",
} as const;

/**
 * The bound check reports nothing when a query never reaches the table, so each
 * case has to prove it emitted the subquery it claims to be guarding. Without
 * this the suite passes just as happily on a build that stopped joining
 * evaluation data at all.
 */
function missingJoinViolations(sql: string, table: string): string[] {
  if (sql.includes(`FROM ${table}`)) return [];
  return [
    `generated SQL has no FROM ${table} subquery, so the partition-bound check inspected nothing`,
  ];
}

describe("analytics JOIN time bounds", () => {
  describe("given a timeseries query that joins evaluation_runs", () => {
    /**
     * @scenario Every range bound in generated analytics SQL names the bounded table's partition column
     */
    it("bounds each joined table only on its own partition column", () => {
      const violations: string[] = [];

      for (const timeScale of [1440, "full" as const]) {
        for (const groupBy of [undefined, "metadata.model" as const]) {
          resetParamCounter();
          const { sql } = buildTimeseriesQuery({
            ...baseInput,
            timeScale,
            groupBy,
            series: [COST_SERIES, EVAL_SERIES],
          });
          violations.push(
            ...missingJoinViolations(sql, "evaluation_runs"),
            ...partitionBoundViolations(sql),
          );
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe("given a filter-values query over evaluation_runs", () => {
    /**
     * @scenario Filter-value queries bound evaluation_runs on its own partition column
     */
    it("bounds each joined table only on its own partition column", () => {
      const violations: string[] = [];

      for (const field of [
        "evaluations.evaluator_id",
        "evaluations.evaluator_id.guardrails_only",
      ] as FilterField[]) {
        resetParamCounter();
        const { sql } = buildDataForFilterQuery(
          baseInput.projectId,
          field,
          baseInput.startDate,
          baseInput.endDate,
        );
        violations.push(
          ...missingJoinViolations(sql, "evaluation_runs"),
          ...partitionBoundViolations(sql),
        );
      }

      expect(violations).toEqual([]);
    });
  });

  describe("given an evaluation_runs bound qualified with the table's own name", () => {
    /**
     * @scenario Bounds qualified with the bounded table's own name are inspected, not skipped
     */
    it("sees both evaluation_runs bounds and allows the legacy one", () => {
      resetParamCounter();
      const { sql } = buildTimeseriesQuery({
        ...baseInput,
        timeScale: "full" as const,
        series: [EVAL_SERIES],
      });

      expect(missingJoinViolations(sql, "evaluation_runs")).toEqual([]);
      expect(rangeBoundColumnsByTable(sql).get("evaluation_runs")).toEqual(
        new Set(["ScheduledAt", "UpdatedAt"]),
      );
      expect(partitionBoundViolations(sql)).toEqual([]);
    });

    /**
     * @scenario A qualified bound on a column the table cannot prune on is still reported
     */
    it("reports a qualified bound on a non-partition column", () => {
      const sql =
        "SELECT 1 FROM evaluation_runs WHERE evaluation_runs.CreatedAt >= {startDate:DateTime64(3)}";

      expect(partitionBoundViolations(sql)).toHaveLength(1);
    });

    /**
     * @scenario A bound qualified with the outer query's alias stays out of the inner table's bounds
     */
    it("ignores a bound qualified with an alias rather than a table", () => {
      const sql =
        "SELECT 1 FROM evaluation_runs WHERE ts.OccurredAt >= {startDate:DateTime64(3)}";

      expect(
        rangeBoundColumnsByTable(sql).get("evaluation_runs"),
      ).toBeUndefined();
    });
  });

  describe("given a query that joins stored_spans", () => {
    /**
     * @scenario The guard is non-vacuous: stored_spans really is bounded, on StartTime
     */
    it("bounds stored_spans on StartTime", () => {
      resetParamCounter();
      const { sql } = buildDataForFilterQuery(
        baseInput.projectId,
        "spans.model" as FilterField,
        baseInput.startDate,
        baseInput.endDate,
      );

      expect(missingJoinViolations(sql, "stored_spans")).toEqual([]);
      expect(rangeBoundColumnsByTable(sql).get("stored_spans")).toEqual(
        new Set(["StartTime"]),
      );
      expect(partitionBoundViolations(sql)).toEqual([]);
    });
  });
});
