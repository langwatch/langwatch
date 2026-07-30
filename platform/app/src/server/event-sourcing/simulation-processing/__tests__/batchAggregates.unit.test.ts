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
    const groupBy = sql.slice(sql.indexOf("GROUP BY"));
    expect(groupBy.startsWith("GROUP BY TenantId, ScenarioRunId")).toBe(true);
    expect(groupBy).not.toMatch(/ScenarioSetId/);
  });

  /** @scenario "A batch id filter narrows the outer query, not the dedup subquery" */
  it("places the counting batch id predicate outside the dedup subquery", () => {
    const dedupEnd = sql.indexOf(
      ")",
      sql.indexOf("GROUP BY TenantId, ScenarioRunId"),
    );
    const countingPredicateIndex = sql.lastIndexOf(
      "BatchRunId IN {batchRunIds:Array(String)}",
    );

    expect(countingPredicateIndex).toBeGreaterThan(dedupEnd);
  });

  /** @scenario "One run's several stored versions count as a single row" */
  it("elects the deduped version over every version of a run, not only the batch's own", () => {
    // The dedup's own WHERE bounds it to runs the batches name, never to rows
    // carrying the batch id: a run whose newest version moved to another batch
    // must still be elected by that newest version, so the outer predicate can
    // then leave it out of this batch's counts.
    const dedupSubquery = sql.slice(
      sql.indexOf("IN ("),
      sql.indexOf(")", sql.indexOf("GROUP BY TenantId, ScenarioRunId")) + 1,
    );
    expect(dedupSubquery).toMatch(
      /ScenarioRunId IN \(SELECT ScenarioRunId FROM simulation_runs/,
    );
    // The dedup's own predicate list — not the nested membership subquery a
    // few lines below it, which legitimately names BatchRunId to find which
    // runs to dedup in the first place.
    const dedupOwnWhere = dedupSubquery.slice(
      dedupSubquery.indexOf("WHERE"),
      dedupSubquery.indexOf("ScenarioRunId IN ("),
    );
    expect(dedupOwnWhere).not.toContain("BatchRunId IN");
  });

  it("bounds the dedup to the runs the requested batches name", () => {
    const dedupSubquery = sql.slice(
      sql.indexOf("IN ("),
      sql.indexOf(")", sql.indexOf("GROUP BY TenantId, ScenarioRunId")) + 1,
    );
    expect(dedupSubquery).toContain("BatchRunId IN {batchRunIds:Array(String)}");
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

  it("scopes every subquery to the same tenant as the outer query", () => {
    const occurrences = sql.match(/TenantId = \{tenantId:String\}/g) ?? [];
    // Once in the outer WHERE, once in the dedup subquery's own WHERE, once in
    // the nested membership subquery — three separate FROM simulation_runs,
    // and a predicate missing from any one of them scans that subquery across
    // every tenant's rows.
    expect(occurrences.length).toBe(3);
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
