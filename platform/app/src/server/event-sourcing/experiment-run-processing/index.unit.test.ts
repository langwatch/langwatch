import type { ClickHouseClient } from "@langwatch/clickhouse";
import {
  type Mount,
  parseGroupKey,
  renderGroupKey,
  UndecodableStateError,
  validateMount,
} from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  createExperimentRunProcessingPipeline,
  type ExperimentRunProcessingDeps,
  experimentRunItemsGroupKey,
  experimentRunStateGroupKey,
} from "./index";
import { experimentRunItemsTable, experimentRunsTable } from "./table";

const STARTED_INPUT = {
  runId: "run-1",
  experimentId: "exp-1",
  workflowVersionId: null,
  total: 4,
  targets: [{ id: "t1", name: "T1", type: "prompt" }],
  occurredAt: 1_000,
};

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

function baseDeps(
  overrides: Partial<ExperimentRunProcessingDeps> = {},
): ExperimentRunProcessingDeps {
  return {
    client: fakeClient(),
    experimentRunExecution: null,
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

describe("createExperimentRunProcessingPipeline", () => {
  it("names itself 'experiment_run' and derives the dotted event types already in event_log", () => {
    const built = createExperimentRunProcessingPipeline(baseDeps());
    expect(built.name).toBe("experiment_run");
    expect([...built.eventTypes].sort()).toEqual([
      "lw.experiment_run.completed",
      "lw.experiment_run.evaluator_result",
      "lw.experiment_run.started",
      "lw.experiment_run.target_result",
    ]);
  });

  it("pins the fold's stamp to the deployed version rather than deriving one", () => {
    const built = createExperimentRunProcessingPipeline(baseDeps());
    expect(built.folds.experimentRunState!.stateVersion).toBe("2025-02-01");
    expect(built.folds.experimentRunState!.schemaHash).not.toBe("2025-02-01");
  });

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

  describe("commands", () => {
    it("stamps a started command's emitted event with the derived persisted type", async () => {
      const built = createExperimentRunProcessingPipeline(baseDeps());
      const events = await built.commands.startExperimentRun!.handle(
        STARTED_INPUT,
        {
          now: Date.now(),
          tenantId: "tenant-1",
        },
      );
      expect(events).toEqual([
        { type: "lw.experiment_run.started", data: STARTED_INPUT },
      ]);
    });
  });

  describe("experimentRunStateGroupKey", () => {
    it("scopes the fold to one lane per aggregate (ADR-106: fold-scope-must-be-aggregate)", () => {
      expect(
        experimentRunStateGroupKey({
          tenantId: "tenant-1",
          aggregateId: "exp-1:run-1",
        }),
      ).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "fold", name: "experimentRunState" },
        scope: {
          kind: "aggregate",
          aggregateType: "experiment_run",
          aggregateId: "exp-1:run-1",
        },
      });
    });

    it("renders through the package's own renderer and round-trips", () => {
      const key = experimentRunStateGroupKey({
        tenantId: "tenant-1",
        aggregateId: "exp-1:run-1",
      });
      expect(parseGroupKey(renderGroupKey(key))).toEqual(key);
    });
  });

  describe("experimentRunItemsGroupKey", () => {
    it("gives two different dataset rows two different lanes", () => {
      const base = {
        tenantId: "tenant-1",
        experimentId: "exp-1",
        runId: "run-1",
      };
      expect(experimentRunItemsGroupKey({ ...base, index: 0 })).not.toEqual(
        experimentRunItemsGroupKey({ ...base, index: 1 }),
      );
    });
  });

  describe("the experimentRunState fold", () => {
    it("applies start and writes the run row", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const built = createExperimentRunProcessingPipeline(
        baseDeps({ client: fakeClient({ insert }) }),
      );

      const outcome = await built.folds.experimentRunState!.apply({
        key: "exp-1:run-1",
        tenantId: "tenant-1",
        events: [{ type: "lw.experiment_run.started", data: STARTED_INPUT }],
      });

      expect(outcome).toEqual({ events: 1 });
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: "experiment_runs",
          tenantId: "tenant-1",
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
      const built = createExperimentRunProcessingPipeline(
        baseDeps({ client: fakeClient({ query }) }),
      );

      await built.folds.experimentRunState!.apply({
        key: "exp-1:run-1",
        tenantId: "tenant-1",
        events: [{ type: "lw.experiment_run.started", data: STARTED_INPUT }],
      });

      const call = query.mock.calls[0]![0]!;
      expect(call.params).toMatchObject({
        tenantId: "tenant-1",
        key0: "run-1",
        key1: "exp-1",
      });
      expect(call.settings).toMatchObject({ select_sequential_consistency: 1 });
    });

    it("fails rather than folding onto genesis when a stored row this build cannot decode is read", async () => {
      const storedRow = experimentRunsTable.columnNames.map((name) => {
        const values: Record<string, unknown> = {
          ProjectionId: "exp-1:run-1",
          TenantId: "tenant-1",
          RunId: "run-1",
          ExperimentId: "exp-1",
          WorkflowVersionId: null,
          Version: "some-other-version",
          Total: 4,
          Targets: "[]",
          StartedAt: new Date(1_000),
          FinishedAt: null,
          StoppedAt: null,
          CreatedAt: new Date(),
          UpdatedAt: new Date(),
          _retention_days: 308,
        };
        return experimentRunsTable.columns[name].encode(values[name] as never);
      });
      const built = createExperimentRunProcessingPipeline(
        baseDeps({
          client: fakeClient({
            query: vi.fn().mockResolvedValue({ rows: [storedRow] }),
          }),
        }),
      );

      await expect(
        built.folds.experimentRunState!.apply({
          key: "exp-1:run-1",
          tenantId: "tenant-1",
          events: [
            {
              type: "lw.experiment_run.completed",
              data: {
                runId: "run-1",
                experimentId: "exp-1",
                finishedAt: 9_000,
              },
            },
          ],
        }),
      ).rejects.toBeInstanceOf(UndecodableStateError);
    });
  });

  describe("the experimentRunItems map", () => {
    it("writes one item row per result in a single insert", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const built = createExperimentRunProcessingPipeline(
        baseDeps({ client: fakeClient({ insert }) }),
      );

      const outcome = await built.maps.experimentRunItems!.apply({
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.experiment_run.target_result",
            data: {
              runId: "run-1",
              experimentId: "exp-1",
              index: 0,
              targetId: "t1",
              entry: {},
              occurredAt: 2_000,
            },
          },
          {
            type: "lw.experiment_run.evaluator_result",
            data: {
              runId: "run-1",
              experimentId: "exp-1",
              index: 0,
              targetId: "t1",
              evaluatorId: "ev1",
              status: "processed",
              score: 0.9,
              passed: true,
              occurredAt: 3_000,
            },
          },
        ],
      });

      expect(outcome).toEqual({ written: 2 });
      expect(insert).toHaveBeenCalledOnce();
      expect(columnValue(insert, experimentRunItemsTable, "TenantId")).toBe(
        "tenant-1",
      );
    });

    it("writes nothing for an event the item projection does not subscribe to", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const built = createExperimentRunProcessingPipeline(
        baseDeps({ client: fakeClient({ insert }) }),
      );

      const outcome = await built.maps.experimentRunItems!.apply({
        tenantId: "tenant-1",
        events: [{ type: "lw.experiment_run.started", data: STARTED_INPUT }],
      });

      expect(outcome).toEqual({ written: 0 });
      expect(insert).not.toHaveBeenCalled();
    });
  });

  describe("the experimentRunExecution process manager", () => {
    it("is absent from the built pipeline when experimentRunExecution deps are null", () => {
      const built = createExperimentRunProcessingPipeline(
        baseDeps({ experimentRunExecution: null }),
      );
      expect(built.processManagers.experimentRunExecution).toBeUndefined();
    });

    it("is mounted and evolves on the run's own events when deps are supplied", () => {
      const built = createExperimentRunProcessingPipeline(
        baseDeps({
          experimentRunExecution: {
            completeRun: vi.fn(async () => undefined),
            signalStop: vi.fn(async () => undefined),
            markRunFailed: vi.fn(async () => undefined),
          },
        }),
      );

      const step = built.processManagers.experimentRunExecution!.evolve(
        built.processManagers.experimentRunExecution!.init(),
        { type: "lw.experiment_run.started", data: STARTED_INPUT },
        { now: 10_000, tenantId: "tenant-1", processKey: "exp-1:run-1" },
      );

      expect(step?.nextWakeAt).toBe(10_000 + 30 * 60 * 1000);
    });
  });

  describe("the billingMeterPoke subscriber", () => {
    it("pokes the injected billing dependency on a billable event", async () => {
      const handle = vi.fn(async () => undefined);
      const built = createExperimentRunProcessingPipeline(
        baseDeps({ billingPoke: { handle } }),
      );

      await built.subscribers.billingMeterPoke!.handle(
        { type: "lw.experiment_run.started", data: STARTED_INPUT },
        { now: 1, tenantId: "tenant-1" },
      );

      expect(handle).toHaveBeenCalledWith({ tenantId: "tenant-1" });
    });

    it("no-ops when no billing dependency is supplied", async () => {
      const built = createExperimentRunProcessingPipeline(baseDeps());
      const result = await built.subscribers.billingMeterPoke!.handle(
        { type: "lw.experiment_run.started", data: STARTED_INPUT },
        { now: 1, tenantId: "tenant-1" },
      );
      expect(result).toBeUndefined();
    });
  });

  describe("given the durable write fails", () => {
    it("rejects with the store's own failure rather than reporting success", async () => {
      const failure = new Error("clickhouse said no");
      const built = createExperimentRunProcessingPipeline(
        baseDeps({
          client: fakeClient({ insert: vi.fn().mockRejectedValue(failure) }),
        }),
      );

      await expect(
        built.folds.experimentRunState!.apply({
          key: "exp-1:run-1",
          tenantId: "tenant-1",
          events: [{ type: "lw.experiment_run.started", data: STARTED_INPUT }],
        }),
      ).rejects.toThrow(failure);
    });
  });
});
