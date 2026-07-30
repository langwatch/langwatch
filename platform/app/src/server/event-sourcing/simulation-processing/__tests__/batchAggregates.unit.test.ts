import { describe, expect, it } from "vitest";
import {
  buildBatchAggregateQuery,
  decodeBatchAggregateRows,
} from "../batchAggregates";
import { simulationRunsTable } from "../table";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 *
 * Structural regression tests over the generated SQL: only ClickHouse can
 * execute a GROUP BY, so a unit test proves the query is shaped correctly.
 * `decodeBatchAggregateRows`'s own tests are the behavioural half.
 */

/** Substitutes each bound `Identifier` back in, so a shape is readable. */
function readable(query: {
  sql: string;
  params: Record<string, unknown>;
}): string {
  return query.sql.replace(/\{(id\d+):Identifier\}/g, (_match, key: string) =>
    String(query.params[key]),
  );
}

describe("buildBatchAggregateQuery", () => {
  const built = buildBatchAggregateQuery({
    tenantId: "tenant-1",
    batchRunIds: ["batch-1", "batch-2"],
  });
  const sql = readable(built);

  it("binds every table and column name rather than interpolating it", () => {
    expect(built.sql).not.toContain("simulation_runs");
    expect(built.sql).not.toContain("BatchRunId");
    expect(Object.values(built.params)).toContain("simulation_runs");
  });

  /** @scenario "The batch aggregate query dedups on the table's own declared engine key" */
  it("groups the dedup subquery by exactly the table's declared sort key", () => {
    expect(simulationRunsTable.sortKey).toEqual(["TenantId", "ScenarioRunId"]);
    expect(sql).toMatch(/GROUP BY TenantId, ScenarioRunId\s*\)/);
  });

  it("does not group the dedup subquery by BatchRunId or ScenarioSetId", () => {
    // Isolate the dedup subquery first, so a BatchRunId in the outer scope —
    // which is correct — cannot make this a false negative.
    const dedupSubquery = sql.slice(
      sql.indexOf("IN ("),
      sql.indexOf(")", sql.indexOf("GROUP BY TenantId, ScenarioRunId")) + 1,
    );
    expect(dedupSubquery).not.toMatch(/BatchRunId/);
    expect(dedupSubquery).not.toMatch(/ScenarioSetId/);
  });

  /** @scenario "A batch id filter narrows the outer query, not the dedup subquery" */
  it("places the batch id predicate outside the dedup subquery", () => {
    const dedupEnd = sql.indexOf(
      ")",
      sql.indexOf("GROUP BY TenantId, ScenarioRunId"),
    );
    const batchIdPredicateIndex = sql.indexOf(
      "BatchRunId IN {batchRunIds:Array(String)}",
    );

    expect(batchIdPredicateIndex).toBeGreaterThan(dedupEnd);
  });

  it("binds the batch ids, tenant id and status lists as query parameters", () => {
    expect(built.params).toMatchObject({
      tenantId: "tenant-1",
      batchRunIds: ["batch-1", "batch-2"],
      failStatuses: ["FAILURE", "ERROR", "STALLED"],
      runningStatuses: ["PENDING", "QUEUED", "IN_PROGRESS"],
    });
    expect(built.sql).not.toContain("batch-1");
    expect(built.sql).not.toContain("STALLED");
  });

  it("scopes the dedup subquery to the same tenant as the outer query", () => {
    const occurrences = sql.match(/TenantId = \{tenantId:String\}/g) ?? [];
    // Once in the outer WHERE, once in the dedup subquery's own WHERE — a
    // dedup subquery missing this predicate would compare this tenant's rows
    // against every tenant's rows.
    expect(occurrences.length).toBe(2);
  });
});

describe("decodeBatchAggregateRows", () => {
  /** @scenario "One run's several stored versions count as a single row" */
  it("reports one aggregate row per batch, matching what a correct dedup produces", () => {
    const rows = decodeBatchAggregateRows([
      ["batch-1", "5", "3", "2", "1", "0", "0"],
    ]);

    expect(rows).toEqual([
      {
        batchRunId: "batch-1",
        expectedTotal: 5,
        landedCount: 3,
        passCount: 2,
        failCount: 1,
        cancelledCount: 0,
        runningCount: 0,
      },
    ]);
  });

  it("decodes counts for more than one batch independently", () => {
    const rows = decodeBatchAggregateRows([
      ["batch-1", "2", "2", "2", "0", "0", "0"],
      ["batch-2", "3", "1", "0", "0", "0", "1"],
    ]);

    expect(rows.map((r) => r.batchRunId)).toEqual(["batch-1", "batch-2"]);
    expect(rows[1]).toMatchObject({
      expectedTotal: 3,
      landedCount: 1,
      runningCount: 1,
    });
  });

  it("returns an empty list for an empty result", () => {
    expect(decodeBatchAggregateRows([])).toEqual([]);
  });
});
