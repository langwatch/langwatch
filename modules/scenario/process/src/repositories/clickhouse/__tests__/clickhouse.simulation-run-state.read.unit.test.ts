/** The run-state latest-row read is one tenant's built read on the reader identity (ADR-202). */
import { describe, expect, it } from "vitest";

import { ClickHouseSimulationRunStateRepository } from "../clickhouse.simulation-run-state.repository.ts";

describe("ClickHouseSimulationRunStateRepository.latestRowRead()", () => {
  describe("given no read window", () => {
    const statement = ClickHouseSimulationRunStateRepository.latestRowRead({
      tenantId: "project_1",
      scenarioRunId: "run_1",
      window: undefined,
      holds: () => true,
    });

    it("scopes the read to its one tenant with the tenant setting", () => {
      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantId).toBe("project_1");
      expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
    });

    it("elects the latest version by a scalar max(UpdatedAt) bounded by the run id index", () => {
      expect(statement.sql).toContain("UpdatedAt = (SELECT max(UpdatedAt)");
      expect(statement.sql.match(/\{\{idBound:simulation_runs\.ScenarioRunId:(v\d+)/g)).toEqual([
        expect.any(String),
        expect.any(String),
      ]);
      expect(new Set(statement.sql.match(/ScenarioRunId = \{v\d+:String\}/g))).toHaveProperty(
        "size",
        1,
      );
      expect(statement.sql).toMatch(/LIMIT 1$/);
    });
  });

  describe("given a target that lacks the criteria columns", () => {
    it("reads them as typed empty arrays", () => {
      const { sql } = ClickHouseSimulationRunStateRepository.latestRowRead({
        tenantId: "project_1",
        scenarioRunId: "run_1",
        window: undefined,
        holds: (name) => !name.startsWith("Criteria."),
      });

      expect(sql).toContain("CAST([] AS Array(LowCardinality(String))) AS criteriaStatus");
      expect(sql).toContain("CAST([] AS Array(String)) AS criteriaCriterion");
    });
  });
});
