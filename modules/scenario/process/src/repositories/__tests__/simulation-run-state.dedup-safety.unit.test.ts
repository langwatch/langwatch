/**
 * Regression test: must use scalar max(UpdatedAt) subquery, not tuple form (OOM-prone).
 * Tuple form not PREWHERE-able with many snapshot versions. See integration test.
 */
import { describe, expect, it } from "vitest";

import { ClickHouseSimulationRunStateRepository } from "../clickhouse/clickhouse.simulation-run-state.repository.ts";

describe("simulationRunState.clickhouse.repository findProjection OOM safety", () => {
  const reads = [undefined, { fromMs: 1_000, toMs: 2_000 }].map(
    (window) =>
      ClickHouseSimulationRunStateRepository.latestRowRead({
        tenantId: "project_1",
        scenarioRunId: "run_1",
        window,
        holds: () => true,
      }).sql,
  );

  it("resolves the latest version with a scalar max(UpdatedAt) subquery", () => {
    for (const sql of reads) expect(sql).toMatch(/UpdatedAt = \(SELECT max\(UpdatedAt\)/);
  });

  it("does not read the latest version via an UpdatedAt IN-tuple subquery", () => {
    for (const sql of reads) expect(sql).not.toMatch(/ScenarioRunId, UpdatedAt\) IN/);
  });
});
