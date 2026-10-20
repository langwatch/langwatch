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
  const repository = SimulationClickHouseRepository.create(async () => ({
    query: async ({ query }) => {
      statements.push(query);
      return { json: async () => [] };
    },
    select: (input) => columns.select(input),
  }));
  return { statements, repository };
}

describe("SimulationClickHouseRepository criteria columns", () => {
  describe("given the target has no `Criteria.*` columns yet", () => {
    /** @scenario "A run read before the per-criterion columns exist answers no per-criterion verdicts" */
    it("selects empty typed arrays under the column names", async () => {
      const { statements, repository } = readRunOver(BEFORE_00101);

      await repository.findScenarioRunData({ projectId: "project_1", scenarioRunId: "run_1" });

      expect(statements[0]).toContain("CAST([] AS Array(String)) AS `Criteria.Criterion`");
      expect(statements[0]).toContain(
        "CAST([] AS Array(LowCardinality(String))) AS `Criteria.Status`",
      );
    });
  });

  describe("given the target has the `Criteria.*` columns", () => {
    /** @scenario "A run read once the per-criterion columns exist answers the stored verdicts" */
    it("selects the stored columns", async () => {
      const { statements, repository } = readRunOver(AFTER_00101);

      await repository.findScenarioRunData({ projectId: "project_1", scenarioRunId: "run_1" });

      expect(statements[0]).toContain("`Criteria.Criterion`, `Criteria.Requirement`");
      expect(statements[0]).not.toContain("AS `Criteria.Criterion`");
    });
  });
});
