import type { ClickHouseClient } from "@langwatch/clickhouse";
import {
  type Mount,
  UndecodableStateError,
  validateMount,
} from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import { experimentRun } from "./aggregate";
import { createExperimentRunPipeline, experimentRunItems } from "./index";
import type { ExperimentRunState } from "./schema";
import { experimentRunItemsTable, experimentRunsTable } from "./table";

const STARTED_INPUT = {
  runId: "run-1",
  experimentId: "exp-1",
  workflowVersionId: null,
  total: 4,
  targets: [{ id: "t1", name: "T1", type: "prompt" }],
  occurredAt: 1_000,
};

function storedRow(version: string): unknown[] {
  const state = experimentRun.apply(
    experimentRun.init(),
    experimentRun.events.started(STARTED_INPUT),
  ) as ExperimentRunState;
  const now = new Date("2026-07-30T00:00:00.000Z");
  const values: Record<string, unknown> = {
    ProjectionId: `${state.experimentId}:${state.runId}`,
    TenantId: "tenant-1",
    RunId: state.runId,
    ExperimentId: state.experimentId,
    WorkflowVersionId: state.workflowVersionId,
    Version: version,
    Total: state.total,
    Targets: JSON.stringify(state.targets),
    StartedAt: new Date(state.startedAt ?? now.getTime()),
    FinishedAt: null,
    StoppedAt: null,
    CreatedAt: now,
    UpdatedAt: now,
    _retention_days: 308,
  };
  return experimentRunsTable.columnNames.map((name) =>
    experimentRunsTable.columns[name].encode(values[name] as never),
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

function columnValue(
  insert: ReturnType<typeof vi.fn>,
  table: typeof experimentRunsTable | typeof experimentRunItemsTable,
  column: string,
  row = 0,
): unknown {
  const rows = insert.mock.calls[0]![0]!.rows as unknown[][];
  return rows[row]![table.columnNames.indexOf(column as never)];
}

describe("the experiment-run mounts (ADR-106)", () => {
  it("mounts the fold as replace/aggregate/batch and the map as append/partition/batch", () => {
    const fold: Mount = {
      projection: "fold",
      store: "replace",
      scope: "aggregate",
      collapse: "batch",
    };
    const map: Mount = {
      projection: "map",
      store: "append",
      scope: "partition",
      collapse: "batch",
    };

    expect(validateMount(fold)).toEqual([]);
    expect(validateMount(map)).toEqual([]);
  });
});

describe("createExperimentRunPipeline", () => {
  describe("given no stored row for the run", () => {
    it("applies start and writes the run row", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const pipeline = createExperimentRunPipeline({
        client: fakeClient({ insert }),
      });

      const outcome = await pipeline.applyExperimentRunCommand({
        tenantId: "tenant-1",
        command: "start",
        input: STARTED_INPUT,
      });

      expect(outcome).toEqual({ events: 1 });
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: "experiment_runs",
          tenantId: "tenant-1",
          columns: experimentRunsTable.columnNames,
          target: { kind: "replacing" },
        }),
      );
      expect(columnValue(insert, experimentRunsTable, "Total")).toBe(4);
      expect(columnValue(insert, experimentRunsTable, "ProjectionId")).toBe(
        "exp-1:run-1",
      );
    });

    it("reads on the full engine key, so two experiments sharing a run slug stay apart", async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const pipeline = createExperimentRunPipeline({
        client: fakeClient({ query }),
      });

      await pipeline.applyExperimentRunCommand({
        tenantId: "tenant-1",
        command: "start",
        input: STARTED_INPUT,
      });

      const call = query.mock.calls[0]![0]!;
      expect(call.params).toMatchObject({
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });
      expect(call.sql).toContain("{runId:String}");
      expect(call.sql).toContain("{experimentId:String}");
      expect(call.sql).not.toContain("experiment_runs");
      expect(call.settings).toMatchObject({ select_sequential_consistency: 1 });
    });
  });

  describe("given a stored row this build cannot decode", () => {
    it("fails rather than folding the command onto genesis state", async () => {
      const pipeline = createExperimentRunPipeline({
        client: fakeClient({
          query: vi.fn().mockResolvedValue({ rows: [storedRow("older")] }),
        }),
      });

      await expect(
        pipeline.applyExperimentRunCommand({
          tenantId: "tenant-1",
          command: "complete",
          input: { runId: "run-1", experimentId: "exp-1", finishedAt: 9_000 },
        }),
      ).rejects.toBeInstanceOf(UndecodableStateError);
    });
  });

  describe("given a stored row this build wrote", () => {
    it("folds onto the stored state, keeping its targets and enrolled total", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const pipeline = createExperimentRunPipeline({
        client: fakeClient({
          query: vi
            .fn()
            .mockResolvedValue({ rows: [storedRow(experimentRun.stateVersion)] }),
          insert,
        }),
      });

      await pipeline.applyExperimentRunCommand({
        tenantId: "tenant-1",
        command: "complete",
        input: { runId: "run-1", experimentId: "exp-1", finishedAt: 9_000 },
      });

      expect(columnValue(insert, experimentRunsTable, "Total")).toBe(4);
      expect(
        JSON.parse(
          String(columnValue(insert, experimentRunsTable, "Targets")),
        ),
      ).toEqual([{ id: "t1", name: "T1", type: "prompt" }]);
      expect(columnValue(insert, experimentRunsTable, "FinishedAt")).not.toBe(
        null,
      );
    });
  });

  describe("given a delivery of result events", () => {
    it("writes one item row per result in a single insert", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const pipeline = createExperimentRunPipeline({
        client: fakeClient({ insert }),
      });

      const outcome = await pipeline.storeItems({
        tenantId: "tenant-1",
        events: [
          experimentRun.events.targetResult({
            runId: "run-1",
            experimentId: "exp-1",
            index: 0,
            targetId: "t1",
            entry: {},
            occurredAt: 2_000,
          }),
          experimentRun.events.evaluatorResult({
            runId: "run-1",
            experimentId: "exp-1",
            index: 0,
            targetId: "t1",
            evaluatorId: "ev1",
            status: "processed",
            score: 0.9,
            passed: true,
            occurredAt: 3_000,
          }),
        ],
      });

      expect(outcome).toEqual({ written: 2 });
      expect(insert).toHaveBeenCalledOnce();
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: "experiment_run_items",
          columns: experimentRunItemsTable.columnNames,
        }),
      );
      expect(columnValue(insert, experimentRunItemsTable, "TenantId")).toBe(
        "tenant-1",
      );
      expect(
        columnValue(insert, experimentRunItemsTable, "ProjectionId", 0),
      ).not.toBe(columnValue(insert, experimentRunItemsTable, "ProjectionId", 1));
    });

    it("writes nothing for an event the item projection does not subscribe to", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const pipeline = createExperimentRunPipeline({
        client: fakeClient({ insert }),
      });

      const outcome = await pipeline.storeItems({
        tenantId: "tenant-1",
        events: [experimentRun.events.started(STARTED_INPUT)],
      });

      expect(outcome).toEqual({ written: 0 });
      expect(insert).not.toHaveBeenCalled();
    });

    it("subscribes to exactly the two result events", () => {
      expect([...experimentRunItems.eventTypes].sort()).toEqual([
        "lw.experiment_run.evaluator_result",
        "lw.experiment_run.target_result",
      ]);
    });
  });

  describe("given the durable write fails", () => {
    it("rejects with the store's own failure rather than reporting success", async () => {
      const failure = new Error("clickhouse said no");
      const pipeline = createExperimentRunPipeline({
        client: fakeClient({ insert: vi.fn().mockRejectedValue(failure) }),
      });

      await expect(
        pipeline.applyExperimentRunCommand({
          tenantId: "tenant-1",
          command: "start",
          input: STARTED_INPUT,
        }),
      ).rejects.toThrow(failure);
    });
  });
});
