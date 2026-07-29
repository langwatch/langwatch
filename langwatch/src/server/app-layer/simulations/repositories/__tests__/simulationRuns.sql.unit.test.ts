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

  describe("given a caller that passes its own filters", () => {
    describe("when the predicate is built", () => {
      it("appends them after the tenant predicate", () => {
        const predicate = simulationRunDedupPredicate({
          tenantIdParam: "tenantId",
          filters: "AND ScenarioSetId IN ({scenarioSetIds:Array(String)})",
        });

        expect(predicate).toContain(
          "WHERE TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)})",
        );
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
