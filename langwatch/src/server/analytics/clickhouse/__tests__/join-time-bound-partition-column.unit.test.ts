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
  /\bFROM\s+([a-zA-Z_]\w*)|(?<![\w.`])([a-zA-Z_]\w*)\s*(?:>=|<=|>|<)\s*\{/g;

/**
 * Range bounds in `sql`, grouped by the table of the nearest preceding
 * `FROM <table>`. Alias-qualified columns (`ts.OccurredAt`) belong to the outer
 * scope by construction and are skipped; only bare identifiers can be captured
 * by the wrong scope.
 */
function rangeBoundColumnsByTable(sql: string): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  let currentTable: string | null = null;

  RANGE_BOUND_OR_TABLE.lastIndex = 0;
  let match: RegExpExecArray | null = RANGE_BOUND_OR_TABLE.exec(sql);
  while (match !== null) {
    const [, table, column] = match;
    if (table) {
      currentTable = table;
    } else if (column && currentTable) {
      const columns = byTable.get(currentTable) ?? new Set<string>();
      columns.add(column);
      byTable.set(currentTable, columns);
    }
    match = RANGE_BOUND_OR_TABLE.exec(sql);
  }

  return byTable;
}

/** One message per bound that names a column the table is not partitioned by. */
function partitionBoundViolations(sql: string): string[] {
  const violations: string[] = [];

  for (const [table, columns] of rangeBoundColumnsByTable(sql)) {
    const partitionColumns = (
      TIME_PARTITIONED_TABLES as Record<string, readonly string[] | undefined>
    )[table];
    if (!partitionColumns) continue;

    for (const column of columns) {
      if (partitionColumns.includes(column)) continue;
      violations.push(
        `${table} is bounded on ${column}, not one of its partition columns (${partitionColumns.join(", ")}); ClickHouse resolves ${column} against the outer trace_summaries scope instead of failing`,
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
