import { createApiFixture } from "@langwatch/api-fixture";
import type { AppendStore, Projection, ProjectionStoreContext } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import type { ExperimentRunPlan } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import type { ExperimentRunStateRepository } from "../../repositories/experiment-run-state.repository.ts";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import {
  type CellFinishedEventData,
  cellFinishedEventDataSchema,
  experimentRunStartedEventSchema,
  type TargetResultEvent,
} from "../experiment-run-events.process.ts";
import {
  AbortExperimentRunCommand,
  FailExperimentCellCommand,
  StartExperimentRunCommand,
} from "../experiment-run-processing.commands.ts";
import {
  type ClickHouseExperimentRunResultRecord,
  ExperimentRunResultStorageMapProjection,
} from "../experiment-run-result-storage.projection.ts";
import type { ExperimentRunStateData } from "../experiment-run-state.projection.ts";
import { ExperimentRunStateStore } from "../experiment-run-state.store.ts";

const tenantId = createTenantId("project_alpha");

const plan: ExperimentRunPlan = {
  concurrency: 2,
  origin: "workbench",
  persistResults: true,
  scope: { type: "full" },
  mappingDatasetId: "dataset_1",
  targets: [{ id: "target_a", type: "prompt", inputs: [], outputs: [], mappings: {} }],
  evaluators: [],
  datasetColumns: [{ id: "question", name: "question", type: "string" }],
  rows: [{ rowIndex: 0, entry: { question: "What is 2 + 2?" } }],
  cells: [
    { ordinal: 0, phase: 1, rowIndex: 0, targetId: "target_a", evaluatorIds: [] },
    { ordinal: 1, phase: 2, rowIndex: 0, targetId: "target_a", evaluatorId: "judge" },
  ],
  pinned: { prompts: [{ targetId: "target_a", promptId: "prompt_1", version: 3 }], workflows: [] },
};

function startedEvent(data: Record<string, unknown>) {
  return {
    id: "event_1",
    aggregateId: "experiment_1:run_1",
    aggregateType: "experiment_run",
    tenantId,
    createdAt: 1_000,
    occurredAt: 1_000,
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: { runId: "run_1", experimentId: "experiment_1", total: 2, targets: [], ...data },
  };
}

function cellFinished({
  experimentId,
}: {
  experimentId: string;
}): CellFinishedEventData & { tenantId: string; occurredAt: number } {
  return {
    tenantId: "project_alpha",
    occurredAt: 2_000,
    runId: "run_1",
    experimentId,
    ordinal: 4,
    phase: 1,
    outcome: "failed",
  };
}

const emptyRunState: ExperimentRunStateData = {
  RunId: "run_1",
  ExperimentId: "",
  WorkflowVersionId: null,
  Total: 0,
  Progress: 0,
  CompletedCount: 0,
  FailedCount: 0,
  TotalCost: null,
  TotalDurationMs: null,
  AvgScoreBps: null,
  PassRateBps: null,
  Targets: "[]",
  CreatedAt: 0,
  UpdatedAt: 0,
  LastEventOccurredAt: 0,
  StartedAt: null,
  FinishedAt: null,
  StoppedAt: null,
  TotalScoreSum: 0,
  ScoreCount: 0,
  PassedCount: 0,
  GradedCount: 0,
  TraceMetrics: {},
};

describe("the run pipeline's shape", () => {
  describe("when a run's start is read back", () => {
    /** @scenario "A run carries its plan in its start, and a run started before the pipeline still reads" */
    it("carries the plan's cells in ordinal order, phase 1 before phase 2", () => {
      const parsed = experimentRunStartedEventSchema.parse(startedEvent({ plan }));

      expect(parsed.data.plan?.cells.map(({ ordinal, phase }) => ({ ordinal, phase }))).toEqual([
        { ordinal: 0, phase: 1 },
        { ordinal: 1, phase: 2 },
      ]);
    });

    /** @scenario "A run carries its plan in its start, and a run started before the pipeline still reads" */
    it("still reads a start recorded before runs carried a plan", () => {
      const parsed = experimentRunStartedEventSchema.parse(startedEvent({}));

      expect(parsed.data.plan).toBeUndefined();
    });
  });

  describe("when a cell finishes", () => {
    it("refuses an outcome the manager does not count", () => {
      expect(
        cellFinishedEventDataSchema.validate({
          ...cellFinished({ experimentId: "e" }),
          outcome: "lost",
        }),
      ).toBe(false);
    });
  });

  describe("given a run with no experiment", () => {
    /** @scenario "A run without an experiment is keyed by its run id and writes no ClickHouse rows" */
    it("keys its aggregate by its run id alone", () => {
      expect(
        StartExperimentRunCommand.getAggregateId({
          tenantId: "project_alpha",
          occurredAt: 1_000,
          runId: "run_1",
          experimentId: "",
          total: 1,
          targets: [],
        }),
      ).toBe("run_1");
    });

    /** @scenario "A run without an experiment is keyed by its run id and writes no ClickHouse rows" */
    it("enqueues none of its results for the result table", () => {
      const projection = ExperimentRunResultStorageMapProjection.create({
        store: createApiFixture<AppendStore<ClickHouseExperimentRunResultRecord>>({}, "items"),
      });
      const filter = projection.options.enqueue?.filter;
      const result = (experimentId: string): TargetResultEvent => ({
        id: "event_2",
        aggregateId: "run_1",
        aggregateType: "experiment_run",
        tenantId,
        createdAt: 1_000,
        occurredAt: 1_000,
        type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
        data: { runId: "run_1", experimentId, index: 0, targetId: "target_a", entry: {} },
      });

      expect(filter?.(result(""))).toBe(false);
      expect(filter?.(result("experiment_1"))).toBe(true);
    });

    /** @scenario "A run without an experiment is keyed by its run id and writes no ClickHouse rows" */
    it("stores no run row", async () => {
      const stored: Projection[] = [];
      const store = ExperimentRunStateStore.create({
        repository: createApiFixture<ExperimentRunStateRepository>(
          {
            storeProjection: (projection) => {
              stored.push(projection);
              return Promise.resolve();
            },
          },
          "runState",
        ),
      });
      const context: ProjectionStoreContext = { aggregateId: "run_1", tenantId };

      await store.store(emptyRunState, context);

      expect(stored).toEqual([]);
    });
  });

  describe("given a cell the stall wake failed as lost", () => {
    /** @scenario "A cell failed as lost that finishes after all is recorded once" */
    it("records its finish under the one key a later finish of the same cell also carries", async () => {
      const handle = (outcome: "failed" | "succeeded") =>
        new FailExperimentCellCommand().handle({
          tenantId,
          aggregateId: "experiment_1:run_1",
          type: "lw.experiment_run.fail_cell",
          data: { ...cellFinished({ experimentId: "experiment_1" }), outcome },
        });

      const [lost] = await handle("failed");
      const [finished] = await handle("succeeded");

      expect(lost?.idempotencyKey).toBe("project_alpha:run_1:cell:4:1:finished");
      expect(finished?.idempotencyKey).toBe(lost?.idempotencyKey);
      expect(lost?.aggregateId).toBe("experiment_1:run_1");
    });
  });

  describe("given a run a project asks to abort twice", () => {
    /** @scenario "An abort is recorded once however often it is asked for" */
    it("records both requests under one key on the run's own aggregate", async () => {
      const abort = (occurredAt: number) =>
        new AbortExperimentRunCommand().handle({
          tenantId,
          aggregateId: "experiment_1:run_1",
          type: "lw.experiment_run.abort",
          data: {
            tenantId: "project_alpha",
            occurredAt,
            runId: "run_1",
            experimentId: "experiment_1",
            requestedBy: "user_1",
          },
        });

      const [first] = await abort(1_000);
      const [second] = await abort(2_000);

      expect(first?.idempotencyKey).toBe("project_alpha:run_1:abort");
      expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
      expect(first?.aggregateId).toBe("experiment_1:run_1");
    });
  });
});
