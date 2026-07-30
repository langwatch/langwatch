import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import { experimentRun } from "./aggregate";
import type { ExperimentRunState } from "./schema";
import { createExperimentRunsStore } from "./store";
import { type ExperimentRunsRow, experimentRunsTable } from "./table";

const EXPECTED_VERSION = experimentRun.stateVersion;

interface InsertCall {
  readonly tenantId: string;
  readonly table: string;
  readonly rows: unknown[][];
  readonly columns: readonly string[];
  readonly target: unknown;
}

interface FakeClient extends ClickHouseClient {
  readonly queryCalls: QueryOptions[];
  readonly insertCalls: InsertCall[];
}

function createFakeClient(
  overrides: {
    query?: (options: QueryOptions) => Promise<{
      rows: unknown[][];
      header?: { names: string[]; types: string[] };
    }>;
  } = {},
): FakeClient {
  const queryCalls: QueryOptions[] = [];
  const insertCalls: InsertCall[] = [];
  return {
    queryCalls,
    insertCalls,
    async query(options) {
      queryCalls.push(options);
      if (overrides.query) return overrides.query(options);
      return { rows: [] };
    },
    stream() {
      throw new Error("not used by this store");
    },
    async insert(options) {
      insertCalls.push(options as InsertCall);
    },
    async close() {
      // Not exercised by this store's read/write paths — nothing to release.
    },
  };
}

/** Encodes a full row via each column's own `.encode()`, so a fixture never hand-guesses ClickHouse's wire format. */
function encodeRow(row: ExperimentRunsRow): unknown[] {
  return experimentRunsTable.columnNames.map((name) =>
    experimentRunsTable.columns[name].encode(row[name] as never),
  );
}

function fixtureRow(
  overrides: Partial<ExperimentRunsRow> = {},
): ExperimentRunsRow {
  return {
    ProjectionId: "exp-1:run-1",
    TenantId: "tenant-1",
    RunId: "run-1",
    ExperimentId: "exp-1",
    WorkflowVersionId: null,
    Version: EXPECTED_VERSION,
    Total: 5,
    Targets: JSON.stringify([{ id: "t1", name: "T1", type: "prompt" }]),
    StartedAt: new Date("2026-01-01T00:00:00.000Z"),
    FinishedAt: null,
    StoppedAt: null,
    CreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    UpdatedAt: new Date("2026-01-01T00:00:01.000Z"),
    DeliverySeq: 3n,
    _retention_days: 49,
    ...overrides,
  };
}

const HEADER = {
  names: [...experimentRunsTable.columnNames],
  types: experimentRunsTable.columnNames.map(
    (name) => experimentRunsTable.columns[name].chType,
  ),
};

describe("createExperimentRunsStore", () => {
  describe("given no row exists for the key", () => {
    it("reports absent", async () => {
      const client = createFakeClient();
      const store = createExperimentRunsStore({
        client,
        expectedVersion: EXPECTED_VERSION,
      });

      const result = await store.read("exp-1:run-1", { tenantId: "tenant-1" });

      expect(result).toEqual({ kind: "absent" });
    });

    it("parses the key into RunId/ExperimentId and filters on them, not on ProjectionId", async () => {
      const client = createFakeClient();
      const store = createExperimentRunsStore({
        client,
        expectedVersion: EXPECTED_VERSION,
      });

      await store.read("exp-1:run-1", { tenantId: "tenant-1" });

      expect(client.queryCalls).toHaveLength(1);
      expect(client.queryCalls[0]?.params).toEqual({
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });
    });

    it("reads with read-your-writes sequential consistency (ADR-098)", async () => {
      const client = createFakeClient();
      const store = createExperimentRunsStore({
        client,
        expectedVersion: EXPECTED_VERSION,
      });

      await store.read("exp-1:run-1", { tenantId: "tenant-1" });

      expect(client.queryCalls[0]?.settings).toEqual({
        select_sequential_consistency: 1,
      });
    });
  });

  describe("given a row exists at the expected version", () => {
    it("decodes it into the narrow state — no counter fields to lose", async () => {
      const row = fixtureRow();
      const client = createFakeClient({
        query: async () => ({ rows: [encodeRow(row)], header: HEADER }),
      });
      const store = createExperimentRunsStore({
        client,
        expectedVersion: EXPECTED_VERSION,
      });

      const result = await store.read("exp-1:run-1", { tenantId: "tenant-1" });

      expect(result.kind).toBe("found");
      if (result.kind !== "found") throw new Error("unreachable");
      const state: ExperimentRunState = result.stored.state;
      expect(state).toEqual({
        runId: "run-1",
        experimentId: "exp-1",
        workflowVersionId: null,
        total: 5,
        targets: [{ id: "t1", name: "T1", type: "prompt" }],
        startedAt: row.StartedAt.getTime(),
        finishedAt: null,
        stoppedAt: null,
      });
      expect(result.stored.version).toBe(EXPECTED_VERSION);
    });
  });

  describe("given a row exists at a different version", () => {
    it("reports undecodable rather than treating the row as absent (ADR-098 decision 6)", async () => {
      const row = fixtureRow({ Version: "some-other-version" });
      const client = createFakeClient({
        query: async () => ({ rows: [encodeRow(row)], header: HEADER }),
      });
      const store = createExperimentRunsStore({
        client,
        expectedVersion: EXPECTED_VERSION,
      });

      const result = await store.read("exp-1:run-1", { tenantId: "tenant-1" });

      expect(result).toEqual({
        kind: "undecodable",
        storedVersion: "some-other-version",
      });
    });
  });

  describe("write", () => {
    it("inserts one row with a retryable replacing target", async () => {
      const client = createFakeClient();
      const store = createExperimentRunsStore({
        client,
        expectedVersion: EXPECTED_VERSION,
      });

      await store.write(
        "exp-1:run-1",
        {
          state: {
            runId: "run-1",
            experimentId: "exp-1",
            workflowVersionId: "wf-1",
            total: 3,
            targets: [],
            startedAt: 1_000,
            finishedAt: null,
            stoppedAt: null,
          },
          deliverySeq: 7,
          version: EXPECTED_VERSION,
        },
        { tenantId: "tenant-1", retentionDays: 30 },
      );

      expect(client.insertCalls).toHaveLength(1);
      const call = client.insertCalls[0]!;
      expect(call.table).toBe("experiment_runs");
      expect(call.target).toEqual({ kind: "replacing" });
      expect(call.columns).toEqual(experimentRunsTable.columnNames);

      const decoded: Record<string, unknown> = {};
      experimentRunsTable.columnNames.forEach((name, i) => {
        decoded[name] = experimentRunsTable.columns[name].decode(
          call.rows[0]![i],
        );
      });
      expect(decoded.RunId).toBe("run-1");
      expect(decoded.ExperimentId).toBe("exp-1");
      expect(decoded.Total).toBe(3);
      expect(decoded._retention_days).toBe(30);
    });

    it("falls back to the platform default retention when none is supplied", async () => {
      const client = createFakeClient();
      const store = createExperimentRunsStore({
        client,
        expectedVersion: EXPECTED_VERSION,
      });

      await store.write(
        "exp-1:run-1",
        {
          state: {
            runId: "run-1",
            experimentId: "exp-1",
            workflowVersionId: null,
            total: 0,
            targets: [],
            startedAt: null,
            finishedAt: null,
            stoppedAt: null,
          },
          deliverySeq: 1,
          version: EXPECTED_VERSION,
        },
        { tenantId: "tenant-1" },
      );

      const call = client.insertCalls[0]!;
      const retentionIndex =
        experimentRunsTable.columnNames.indexOf("_retention_days");
      expect(
        experimentRunsTable.columns._retention_days.decode(
          call.rows[0]![retentionIndex],
        ),
      ).toBe(308);
    });
  });
});
