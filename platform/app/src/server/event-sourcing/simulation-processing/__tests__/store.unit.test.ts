import type { ClickHouseClient } from "@langwatch/clickhouse";
import { describe, expect, it, vi } from "vitest";
import { simulationRun } from "../aggregate";
import { initSimulationRunState } from "../schema";
import { createSimulationRunsStore } from "../store";
import { type SimulationRunsRow, simulationRunsTable } from "../table";

/** Builds a fully-populated wire row and encodes it, matching what a real read would return. */
function encodedRow(overrides: Partial<SimulationRunsRow> = {}): unknown[] {
  const now = new Date("2026-07-30T00:00:00.000Z");
  const row: SimulationRunsRow = {
    ProjectionId: "run-1",
    TenantId: "tenant-1",
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Version: simulationRun.stateVersion,
    Status: "SUCCESS",
    Name: "My run",
    Description: null,
    Metadata: null,
    "Messages.Id": ["m1"],
    "Messages.Role": ["user"],
    "Messages.Content": ["hello"],
    "Messages.TraceId": [""],
    "Messages.Rest": [""],
    TraceIds: ["trace-1"],
    Verdict: "success",
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: 1500n,
    TotalCost: 0.5,
    RoleCosts: new Map([["agent", [0.5]]]),
    RoleLatencies: new Map([["agent", [200]]]),
    StartedAt: now,
    QueuedAt: now,
    CreatedAt: now,
    UpdatedAt: now,
    FinishedAt: now,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: now,
    LastEventOccurredAt: now,
    BatchTotal: 3,
    DeliverySeq: 7n,
    _retention_days: 308,
    ...overrides,
  };
  return simulationRunsTable.columnNames.map((name) =>
    simulationRunsTable.columns[name].encode(row[name]),
  );
}

function fakeClient(
  overrides: Partial<ClickHouseClient> = {},
): ClickHouseClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    stream: vi.fn(),
    insert: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createSimulationRunsStore", () => {
  describe("given no row exists for the aggregate", () => {
    it("reports absent", async () => {
      const store = createSimulationRunsStore({
        client: fakeClient(),
        expectedVersion: simulationRun.stateVersion,
      });

      const result = await store.read("run-1", { tenantId: "tenant-1" });
      expect(result.kind).toBe("absent");
    });
  });

  describe("given a row whose stored version matches this build", () => {
    it("decodes the row back into simulation run state", async () => {
      const client = fakeClient({
        query: vi.fn().mockResolvedValue({ rows: [encodedRow()] }),
      });
      const store = createSimulationRunsStore({
        client,
        expectedVersion: simulationRun.stateVersion,
      });

      const result = await store.read("run-1", { tenantId: "tenant-1" });
      expect(result.kind).toBe("found");
      if (result.kind !== "found") throw new Error("unreachable");

      expect(result.stored.deliverySeq).toBe(7);
      expect(result.stored.version).toBe(simulationRun.stateVersion);
      expect(result.stored.state.scenarioRunId).toBe("run-1");
      expect(result.stored.state.status).toBe("SUCCESS");
      expect(result.stored.state.batchTotal).toBe(3);
      expect(result.stored.state.messages).toEqual([
        { id: "m1", role: "user", content: "hello", traceId: "", rest: "" },
      ]);
      expect(result.stored.state.roleCosts).toEqual({ agent: [0.5] });
      expect(result.stored.state.durationMs).toBe(1500);
    });

    it("issues the read with read-your-writes consistency", async () => {
      const query = vi.fn().mockResolvedValue({ rows: [encodedRow()] });
      const store = createSimulationRunsStore({
        client: fakeClient({ query }),
        expectedVersion: simulationRun.stateVersion,
      });

      await store.read("run-1", { tenantId: "tenant-1" });

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            select_sequential_consistency: 1,
          }),
        }),
      );
    });
  });

  describe("given a row whose stored version does not match this build", () => {
    /**
     * ADR-098 decision 6: an undecodable row is never treated as absent —
     * folding onto a fresh accumulator would overwrite live state.
     */
    it("reports undecodable rather than absent or found", async () => {
      const client = fakeClient({
        query: vi.fn().mockResolvedValue({
          rows: [encodedRow({ Version: "some-other-hash" })],
        }),
      });
      const store = createSimulationRunsStore({
        client,
        expectedVersion: simulationRun.stateVersion,
      });

      const result = await store.read("run-1", { tenantId: "tenant-1" });
      expect(result.kind).toBe("undecodable");
      if (result.kind !== "undecodable") throw new Error("unreachable");
      expect(result.storedVersion).toBe("some-other-hash");
    });
  });

  describe("given a write", () => {
    it("inserts a durable row and does not resolve until the insert resolves", async () => {
      let resolveInsert: (() => void) | undefined;
      const insert = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveInsert = resolve;
          }),
      );
      const store = createSimulationRunsStore({
        client: fakeClient({ insert }),
        expectedVersion: simulationRun.stateVersion,
      });

      let settled = false;
      const writing = store
        .write(
          "run-1",
          {
            state: { ...initSimulationRunState(), scenarioRunId: "run-1" },
            deliverySeq: 1,
            version: simulationRun.stateVersion,
          },
          { tenantId: "tenant-1" },
        )
        .then(() => {
          settled = true;
        });

      expect(insert).toHaveBeenCalledOnce();
      // Give any stray microtask a turn — write() must still be pending,
      // because the fake insert() has not resolved yet.
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);

      resolveInsert?.();
      await writing;
      expect(settled).toBe(true);
    });

    it("writes to the simulation_runs table with the declared column list", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const store = createSimulationRunsStore({
        client: fakeClient({ insert }),
        expectedVersion: simulationRun.stateVersion,
      });

      await store.write(
        "run-1",
        {
          state: { ...initSimulationRunState(), scenarioRunId: "run-1" },
          deliverySeq: 1,
          version: simulationRun.stateVersion,
        },
        { tenantId: "tenant-1" },
      );

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: "simulation_runs",
          tenantId: "tenant-1",
          columns: simulationRunsTable.columnNames,
          target: { kind: "replacing" },
        }),
      );
    });
  });
});
