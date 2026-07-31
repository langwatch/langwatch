/**
 * @vitest-environment node
 *
 * The dedup predicate's inner subquery is a full read of `simulation_runs` in
 * its own right — it decides which (run, version) tuples the outer query may
 * see. It used to take the tenant predicate as part of a free-form filter
 * string, so nothing in the shape stopped a caller from omitting it and
 * deduping one tenant's runs against every tenant's rows.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { simulationRunDedupPredicate } from "../simulationRuns.sql";

describe("simulationRunDedupPredicate", () => {
  describe("given a caller that passes no filters at all", () => {
    describe("when the predicate is built", () => {
      it("still scopes the inner subquery to the tenant", () => {
        const predicate = simulationRunDedupPredicate({
          tenantIdParam: "tenantId",
        });

        expect(predicate).toContain("WHERE TenantId = {tenantId:String}");
      });
    });
  });

  describe("given the table's engine key", () => {
    describe("when the predicate is built", () => {
      // simulation_runs is ORDER BY (TenantId, ScenarioRunId) — see
      // 00002_create_schema.sql. Grouping wider splits one run's versions into
      // several groups, and every sub-group's max(UpdatedAt) satisfies the
      // IN-tuple, so the outer query gets the run back once per group. The fold
      // seeds BatchRunId/ScenarioSetId to "", so a message snapshot that lands
      // before the started event is exactly such a second group.
      it("groups on (TenantId, ScenarioRunId) and nothing wider", () => {
        const predicate = simulationRunDedupPredicate({
          tenantIdParam: "tenantId",
        });

        expect(predicate).toContain("GROUP BY TenantId, ScenarioRunId");
        expect(predicate).not.toContain("ScenarioSetId");
        expect(predicate).not.toContain("BatchRunId");
        expect(predicate).toContain(
          "AND (TenantId, ScenarioRunId, UpdatedAt) IN (",
        );
      });
    });
  });

  describe("given an outer query that aliases the table", () => {
    describe("when the predicate is built with that alias", () => {
      // RUN_COLUMNS / LIST_COLUMNS project `toString(...) AS UpdatedAt`, a
      // String alias that shadows the raw DateTime64 column.
      it("qualifies the outer tuple so UpdatedAt resolves to the column", () => {
        const predicate = simulationRunDedupPredicate({
          tenantIdParam: "tenantId",
          alias: "t",
        });

        expect(predicate).toContain(
          "AND (t.TenantId, t.ScenarioRunId, t.UpdatedAt) IN (",
        );
        // The subquery selects no aliases, so it stays unqualified.
        expect(predicate).toContain(
          "SELECT TenantId, ScenarioRunId, max(UpdatedAt)",
        );
      });
    });
  });

  describe("given a caller that passes a partition-key range filter", () => {
    describe("when the predicate is built", () => {
      it("appends it after the tenant predicate so the inner scan prunes too", () => {
        const predicate = simulationRunDedupPredicate({
          tenantIdParam: "tenantId",
          partitionFilters:
            "AND StartedAt >= fromUnixTimestamp64Milli(toUInt64({startDateMs:String}))",
        });

        expect(predicate).toContain(
          "WHERE TenantId = {tenantId:String} AND StartedAt >= fromUnixTimestamp64Milli(toUInt64({startDateMs:String}))",
        );
      });
    });
  });

  describe("given a caller that repeats a fold-written equality filter", () => {
    describe("when the predicate is built", () => {
      // This is the shape that made the inner group resolve to a stale version:
      // ScenarioSetId / BatchRunId revert to "" on a fold re-init, so the
      // version holding max(UpdatedAt) can be the one the filter excludes.
      it.each([
        "ScenarioSetId",
        "BatchRunId",
        "Status",
      ])("refuses to narrow the dedup scope on %s", (column) => {
        expect(() =>
          simulationRunDedupPredicate({
            tenantIdParam: "tenantId",
            partitionFilters: `AND ${column} IN ({values:Array(String)})`,
          }),
        ).toThrow(new RegExp(`must not narrow the dedup scope on ${column}`));
      });
    });
  });

  describe("given a caller whose fragment does not start with AND", () => {
    describe("when the predicate is built", () => {
      it("refuses to widen the inner read past the tenant", () => {
        expect(() =>
          simulationRunDedupPredicate({
            tenantIdParam: "tenantId",
            partitionFilters: "OR 1 = 1",
          }),
        ).toThrow(/must start with "AND"/);
      });
    });
  });

  describe("given the repository's own call sites", () => {
    describe("when the source is read", () => {
      it("binds every one of them to a tenant parameter", () => {
        const source = fs.readFileSync(
          path.resolve(__dirname, "..", "simulation.clickhouse.repository.ts"),
          "utf-8",
        );

        const callSites = dedupPredicateArguments(source);

        expect(callSites.length).toBeGreaterThan(0);
        // Per call site, not in aggregate: counting `tenantIdParam` across the
        // whole file cannot tell which call site each one belongs to, so one
        // unscoped call plus a stray mention elsewhere would still balance.
        for (const [index, argument] of callSites.entries()) {
          expect(
            argument,
            `simulationRunDedupPredicate call site #${index + 1} is not tenant-scoped`,
          ).toContain('tenantIdParam: "tenantId"');
        }
      });

      // The runtime guard only fires on call sites a test actually reaches;
      // this catches the rest.
      it("narrows none of them on a fold-written column", () => {
        const source = fs.readFileSync(
          path.resolve(__dirname, "..", "simulation.clickhouse.repository.ts"),
          "utf-8",
        );

        for (const [index, argument] of dedupPredicateArguments(
          source,
        ).entries()) {
          for (const column of ["ScenarioSetId", "BatchRunId", "Status"]) {
            expect(
              argument,
              `simulationRunDedupPredicate call site #${index + 1} narrows the dedup scope on ${column}`,
            ).not.toContain(column);
          }
        }
      });
    });
  });
});

/**
 * The argument object literal of every `simulationRunDedupPredicate(...)` call
 * in `source`, each as its own string.
 *
 * A brace counter rather than a regex: one call site spans several lines, and
 * the `filters` values embed both template placeholders (`${...}`) and
 * ClickHouse parameter tokens (`{x:String}`) — all balanced, so the count still
 * lands on the literal's own closing brace.
 */
function dedupPredicateArguments(source: string): string[] {
  const CALL = "simulationRunDedupPredicate({";
  const args: string[] = [];
  let from = source.indexOf(CALL);

  while (from !== -1) {
    const open = from + CALL.length - 1;
    let depth = 0;
    let cursor = open;
    for (; cursor < source.length; cursor++) {
      if (source[cursor] === "{") depth++;
      else if (source[cursor] === "}" && --depth === 0) break;
    }
    args.push(source.slice(open, cursor + 1));
    from = source.indexOf(CALL, cursor);
  }

  return args;
}
