import { describe, expect, it } from "vitest";
import {
  buildBatchAggregateQuery,
  decodeBatchAggregateRows,
} from "../batchAggregates";
import { simulationRunsTable } from "../table";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 *
 * These are structural regression tests over the generated SQL, the same
 * level the old pipeline's own regression test for this defect class used
 * (`repositories/__tests__/simulationRunState.dedup-safety.unit.test.ts`):
 * ClickHouse itself is the only thing that can execute a GROUP BY, so a unit
 * test proves the query is SHAPED correctly, not that the server returns the
 * right rows. `decodeBatchAggregateRows`'s own tests below are the
 * behavioural half — they prove this module's own code (not ClickHouse's)
 * reconstructs the right JS values from what a correctly-shaped query would
 * return.
 */
describe("buildBatchAggregateQuery", () => {
  const built = buildBatchAggregateQuery({
    tenantId: "tenant-1",
    batchRunIds: ["batch-1", "batch-2"],
  });

  /** @scenario "The batch aggregate query dedups on the table's own declared engine key" */
  it("groups the dedup subquery by exactly the table's declared sort key", () => {
    expect(simulationRunsTable.sortKey).toEqual(["TenantId", "ScenarioRunId"]);
    expect(built.sql).toMatch(/GROUP BY TenantId, ScenarioRunId\s*\)/);
  });

  it("does not group the dedup subquery by BatchRunId or ScenarioSetId", () => {
    // Isolate the dedup subquery (inside the IN (...) clause) before
    // asserting on it, so a BatchRunId appearing in the OUTER scope (which
    // is correct and expected) cannot make this assertion a false negative.
    const dedupSubquery = built.sql.slice(
      built.sql.indexOf("IN ("),
      built.sql.indexOf(
        ")",
        built.sql.indexOf("GROUP BY TenantId, ScenarioRunId"),
      ) + 1,
    );
    expect(dedupSubquery).not.toMatch(/BatchRunId/);
    expect(dedupSubquery).not.toMatch(/ScenarioSetId/);
  });

  /** @scenario "A batch id filter narrows the outer query, not the dedup subquery" */
  it("places the batch id predicate outside the dedup subquery", () => {
    const dedupEnd = built.sql.indexOf(
      ")",
      built.sql.indexOf("GROUP BY TenantId, ScenarioRunId"),
    );
    const batchIdPredicateIndex = built.sql.indexOf(
      "BatchRunId IN {batchRunIds:Array(String)}",
    );

    expect(batchIdPredicateIndex).toBeGreaterThan(dedupEnd);
  });

  it("binds the batch ids and tenant id as query parameters, not string-interpolated", () => {
    expect(built.params).toEqual({
      tenantId: "tenant-1",
      batchRunIds: ["batch-1", "batch-2"],
    });
    expect(built.sql).not.toContain("batch-1");
  });

  it("scopes the dedup subquery to the same tenant as the outer query", () => {
    const occurrences =
      built.sql.match(/TenantId = \{tenantId:String\}/g) ?? [];
    // Once in the outer WHERE, once in the dedup subquery's own WHERE — a
    // dedup subquery missing this predicate would compare this tenant's
    // rows against every tenant's rows.
    expect(occurrences.length).toBe(2);
  });
});

describe("decodeBatchAggregateRows", () => {
  /** @scenario "One run's several stored versions count as a single row" */
  it("reports one aggregate row per batch, matching what a correct dedup produces", () => {
    // Simulates the wire result a correctly-deduped, correctly-grouped query
    // returns for a batch with 3 runs landed against a total of 5: one row
    // per BatchRunId, never one row per run version.
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
