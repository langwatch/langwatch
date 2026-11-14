/**
 * @vitest-environment node
 * @see modules/scenario/specs/simulation-run.feature
 */
import { ClickHouseColumns } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

const BEFORE_00101 = [{ table: "simulation_runs", name: "ScenarioRunId" }];
const AFTER_00101 = [
  ...BEFORE_00101,
  ...["Criterion", "Requirement", "Status", "Reasoning"].map((field) => ({
    table: "simulation_runs",
    name: `Criteria.${field}`,
  })),
];

function readRunOver(columnList: readonly { table: string; name: string }[]) {
  const statements: string[] = [];
  const columns = ClickHouseColumns.over({ read: async () => columnList });
  const repository = SimulationClickHouseRepository.create({
    sessions: async () => ({
      holds: (input) => columns.holds(input),
      read: async ({ statement }) => {
        statements.push(statement.sql);
        return { rows: [] };
      },
    }),
    clickhouse: { read: () => Promise.reject(new Error("a run read is one tenant's")) },
  });
  return { statements, repository };
}

describe("SimulationClickHouseRepository criteria columns", () => {
  describe("given the target has no `Criteria.*` columns yet", () => {
    /** @scenario "A run read before the per-criterion columns exist answers no per-criterion verdicts" */
    it("selects empty typed arrays under the column names", async () => {
      const { statements, repository } = readRunOver(BEFORE_00101);

      await repository.findScenarioRunData({ projectId: "project_1", scenarioRunId: "run_1" });

      expect(statements[0]).not.toContain("`Criteria.Criterion`");
      expect(statements[0]).toMatch(/Array\(String\)\) AS criteriaCriterion/);
      expect(statements[0]).toMatch(/Array\(LowCardinality\(String\)\)\) AS criteriaStatus/);
    });
  });

  describe("given the target has the `Criteria.*` columns", () => {
    /** @scenario "A run read once the per-criterion columns exist answers the stored verdicts" */
    it("selects the stored columns", async () => {
      const { statements, repository } = readRunOver(AFTER_00101);

      await repository.findScenarioRunData({ projectId: "project_1", scenarioRunId: "run_1" });

      expect(statements[0]).toContain("`Criteria.Criterion` AS criteriaCriterion");
      expect(statements[0]).toContain("`Criteria.Requirement` AS criteriaRequirement");
    });
  });
});
