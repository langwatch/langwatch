import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResilientClickHouseClientForTest as createResilientClickHouseClient } from "~/server/clickhouse/managedClient";
import { startTestContainers, stopTestContainers } from "../integration/testContainers";
import {
  type SimulationRunMetricsProjectionRecord,
  SimulationRunMetricsRepositoryClickHouse,
} from "@langwatch/scenario-server/testing";

const tenantId = `test-sim-metrics-${nanoid()}`;
const scenarioRunId = `run-${nanoid()}`;
const occurredAt = Date.now() - 10_000;

function makeRow(
  overrides: Partial<SimulationRunMetricsProjectionRecord> = {},
): SimulationRunMetricsProjectionRecord {
  return {
    TenantId: tenantId,
    ScenarioRunId: scenarioRunId,
    TraceId: `trace-${nanoid()}`,
    TotalCost: 0.25,
    RoleCosts: { agent: 0.15, judge: 0.1 },
    RoleLatencies: { agent: 1200, judge: 300 },
    OccurredAt: occurredAt,
    EventId: `evt-${nanoid()}`,
    ...overrides,
  };
}

let ch: ClickHouseClient;
let repo: SimulationRunMetricsRepositoryClickHouse;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const resilient = createResilientClickHouseClient({ client: ch });
  repo = new SimulationRunMetricsRepositoryClickHouse(async () => resilient);
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const table of ["simulation_run_metrics", "simulation_run_metrics_rollup"]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  }
  await stopTestContainers();
});

describe("SimulationRunMetricsRepositoryClickHouse.getRunMetrics (integration)", () => {
  describe("when a metrics row is appended twice (retried delivery) and a second trace exists for the same run", () => {
    it("rolls up each trace exactly once and sums across traces", async () => {
      // A retried map-projection append: identical row (same EventId and
      // OccurredAt), delivered as two SEPARATE inserts so the rollup MV sees
      // two blocks — the case a naive sumState would double-count.
      const retried = makeRow({
        TraceId: `trace-retried-${nanoid()}`,
        EventId: `evt-retried-${nanoid()}`,
        TotalCost: 0.25,
        RoleCosts: { agent: 0.15, judge: 0.1 },
        RoleLatencies: { agent: 1200, judge: 300 },
      });
      await repo.insertRow(retried);
      await repo.insertRow(retried);

      const second = makeRow({
        TraceId: `trace-second-${nanoid()}`,
        TotalCost: 0.5,
        RoleCosts: { agent: 0.2, simulator: 0.3 },
        RoleLatencies: { agent: 800, simulator: 2000 },
      });
      await repo.insertRow(second);

      // Per-trace exactly-once, straight from the rollup: the retried trace
      // must appear once with its single-version values.
      const perTrace = await ch.query({
        query: `
          SELECT
            TraceId,
            argMaxMerge(TotalCost) AS TotalCost,
            argMaxMerge(RoleCosts) AS RoleCosts
          FROM simulation_run_metrics_rollup
          WHERE TenantId = {tenantId:String}
            AND ScenarioRunId = {scenarioRunId:String}
          GROUP BY TraceId
          ORDER BY TraceId
        `,
        query_params: { tenantId, scenarioRunId },
        format: "JSONEachRow",
      });
      const traceRows = await perTrace.json<{
        TraceId: string;
        TotalCost: number;
        RoleCosts: Record<string, number>;
      }>();
      expect(traceRows).toHaveLength(2);
      const retriedRow = traceRows.find((r) => r.TraceId === retried.TraceId);
      expect(retriedRow?.TotalCost).toBeCloseTo(0.25);
      expect(retriedRow?.RoleCosts).toEqual({ agent: 0.15, judge: 0.1 });

      // Per-run rollup: total and per-role sums across both traces, with the
      // retry counted exactly once.
      const rollup = await repo.getRunMetrics({ tenantId, scenarioRunId });

      expect(rollup.totalCost).toBeCloseTo(0.75);
      expect(Object.keys(rollup.roleCosts).sort()).toEqual(["agent", "judge", "simulator"]);
      expect(rollup.roleCosts.agent).toBeCloseTo(0.35);
      expect(rollup.roleCosts.judge).toBeCloseTo(0.1);
      expect(rollup.roleCosts.simulator).toBeCloseTo(0.3);
      expect(rollup.roleLatencies).toEqual({
        agent: 2000,
        judge: 300,
        simulator: 2000,
      });
    });
  });

  describe("when the run has no metrics rows", () => {
    it("returns zeros and empty maps", async () => {
      const rollup = await repo.getRunMetrics({
        tenantId,
        scenarioRunId: `run-missing-${nanoid()}`,
      });
      expect(rollup).toEqual({
        totalCost: 0,
        roleCosts: {},
        roleLatencies: {},
      });
    });
  });
});
