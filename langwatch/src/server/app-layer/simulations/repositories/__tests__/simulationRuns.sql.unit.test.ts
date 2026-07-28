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

        const callSites = source.match(/simulationRunDedupPredicate\(\{/g) ?? [];
        const tenantBindings =
          source.match(/tenantIdParam: "tenantId"/g) ?? [];

        expect(callSites.length).toBeGreaterThan(0);
        expect(tenantBindings).toHaveLength(callSites.length);
      });
    });
  });
});
