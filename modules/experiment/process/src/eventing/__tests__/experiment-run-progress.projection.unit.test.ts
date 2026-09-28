import { createTenantId, EventUtils } from "@langwatch/eventing";
import { COMPARISON_EVALUATOR_TYPE, type ExperimentRunPlan } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import { MemoryExperimentRunFoldRepository } from "../../repositories/memory/memory.experiment-run-fold.repository.ts";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import { isPhaseOneFolded } from "../../rules/experiment-run-plan.rules.ts";
import type {
  CellFinishedEvent,
  CellFinishedEventData,
  EvaluatorResultEvent,
  EvaluatorResultEventData,
  ExperimentRunCompletedEvent,
  ExperimentRunCompletedEventData,
  ExperimentRunStartedEvent,
  TargetResultEvent,
  TargetResultEventData,
} from "../experiment-run-events.process.ts";
import { ExperimentRunPlanFoldProjection } from "../experiment-run-plan.projection.ts";
import { ExperimentRunPlanStore } from "../experiment-run-plan.store.ts";
import { ExperimentRunProgressFoldProjection } from "../experiment-run-progress.projection.ts";
import { ExperimentRunProgressStore } from "../experiment-run-progress.store.ts";

const tenantId = createTenantId("project_alpha");
const aggregateId = "experiment_1:run_1";
const run = { runId: "run_1", experimentId: "experiment_1" };

const plan: ExperimentRunPlan = {
  concurrency: 2,
  origin: "workbench",
  persistResults: true,
  scope: { type: "full" },
  mappingDatasetId: "dataset_1",
  targets: [
    { id: "target_a", type: "prompt", inputs: [], outputs: [], mappings: {} },
    { id: "target_b", type: "prompt", inputs: [], outputs: [], mappings: {} },
  ],
  evaluators: [
    { id: "exact", evaluatorType: "langevals/exact_match", inputs: [], mappings: {} },
    {
      id: "saved",
      evaluatorType: "langevals/llm_boolean",
      dbEvaluatorId: "evaluator_db_1",
      inputs: [],
      mappings: {},
    },
    {
      id: "judge",
      evaluatorType: COMPARISON_EVALUATOR_TYPE,
      inputs: [],
      mappings: {},
      comparison: {
        variants: ["target_a", "target_b"],
        hasGoldenAnswer: false,
        goldenField: "",
        includeMetrics: [],
        randomizeOrder: false,
      },
    },
  ],
  datasetColumns: [{ id: "question", name: "question", type: "string" }],
  rows: [{ rowIndex: 0, entry: { question: "What is 2 + 2?" } }],
  cells: [
    { ordinal: 0, phase: 1, rowIndex: 0, targetId: "target_a", evaluatorIds: ["exact"] },
    { ordinal: 1, phase: 1, rowIndex: 0, targetId: "target_b", evaluatorIds: ["exact"] },
    { ordinal: 2, phase: 2, rowIndex: 0, targetId: "target_a", evaluatorId: "judge" },
  ],
  pinned: { prompts: [], workflows: [] },
};

function started(withPlan: ExperimentRunPlan | undefined): ExperimentRunStartedEvent {
  return EventUtils.createEvent<ExperimentRunStartedEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: { ...run, total: 3, targets: [], ...(withPlan ? { plan: withPlan } : {}) },
    occurredAt: 1_000,
  });
}

function targetResult(data: Partial<TargetResultEventData>): TargetResultEvent {
  return EventUtils.createEvent<TargetResultEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
    data: { ...run, index: 0, targetId: "target_a", entry: {}, ...data },
    occurredAt: 2_000,
  });
}

function evaluatorResult(data: Partial<EvaluatorResultEventData>): EvaluatorResultEvent {
  return EventUtils.createEvent<EvaluatorResultEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
    data: {
      ...run,
      index: 0,
      targetId: "target_a",
      evaluatorId: "exact",
      status: "processed",
      ...data,
    },
    occurredAt: 2_000,
  });
}

function cellFinished(
  data: Pick<CellFinishedEventData, "ordinal" | "phase"> & Partial<CellFinishedEventData>,
): CellFinishedEvent {
  return EventUtils.createEvent<CellFinishedEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.CELL_FINISHED,
    data: { ...run, outcome: "succeeded", ...data },
    occurredAt: 3_000,
  });
}

function completed(data: Partial<ExperimentRunCompletedEventData>): ExperimentRunCompletedEvent {
  return EventUtils.createEvent<ExperimentRunCompletedEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
    data: { ...run, finishedAt: 4_000, ...data },
    occurredAt: 4_000,
  });
}

function progressAfter(events: { type: string }[]) {
  const projection = ExperimentRunProgressFoldProjection.create({
    store: ExperimentRunProgressStore.create({
      repository: MemoryExperimentRunFoldRepository.create(),
    }),
  });
  return events.reduce((state, event) => projection.apply(state, event), projection.init());
}

describe("the run's plan fold", () => {
  const folds = MemoryExperimentRunFoldRepository.create();
  const projection = ExperimentRunPlanFoldProjection.create({
    store: ExperimentRunPlanStore.create({ repository: folds }),
  });
  const context = { aggregateId, tenantId };

  describe("when a planned run starts", () => {
    /** @scenario "A cell reads its row, target and evaluators from the run's plan fold" */
    it("keeps the plan the start carried, under the run's key", async () => {
      const state = projection.apply(projection.init(), started(plan));
      await projection.store.store(state, context);

      const read = await folds.readPlan({ runKey: aggregateId });
      expect(read.kind).toBe("folded");
      expect(read.kind === "folded" ? read.state.plan : null).toEqual(plan);
      expect(read.kind === "folded" ? read.state.projectId : null).toBe("project_alpha");
    });
  });

  describe("when a run from before the pipeline drove runs starts", () => {
    it("writes nothing, so no cell ever reads it", async () => {
      const unplanned = MemoryExperimentRunFoldRepository.create();
      const store = ExperimentRunPlanStore.create({ repository: unplanned });

      await store.store(projection.apply(projection.init(), started(undefined)), context);

      expect((await unplanned.readPlan({ runKey: aggregateId })).kind).toBe("empty");
    });
  });
});

describe("the run's progress fold", () => {
  describe("when a target cell's results fold", () => {
    /** @scenario "A comparison cell reads its row's variant outputs from the run's fold" */
    it("keeps the output, cost and duration under the row and target", () => {
      const state = progressAfter([
        started(plan),
        targetResult({ predicted: { output: "4" }, cost: 0.01, duration: 120, traceId: "trace_a" }),
      ]);

      expect(state.targetOutputs["0:target_a"]).toEqual({
        output: "4",
        cost: 0.01,
        duration: 120,
      });
      expect(state.traceIds["0:target_a"]).toBe("trace_a");
    });

    it("keeps no output for a failed target, so a comparison skips it as missing", () => {
      const state = progressAfter([
        started(plan),
        targetResult({ predicted: { output: "4" }, error: "boom", traceId: "trace_a" }),
      ]);

      expect(state.targetOutputs).toEqual({});
      expect(state.traceIds["0:target_a"]).toBe("trace_a");
    });

    it("ignores a result carried over from the board", () => {
      const state = progressAfter([
        started(plan),
        targetResult({ predicted: { output: "4" }, carriedOver: true }),
      ]);

      expect(state.targetOutputs).toEqual({});
    });
  });

  describe("when verdicts fold", () => {
    it("names a saved evaluator's verdict by its record, an inline one by its type", () => {
      const state = progressAfter([
        started(plan),
        evaluatorResult({ evaluatorId: "exact", evaluatorName: "Ignored", score: 1 }),
        evaluatorResult({ evaluatorId: "saved", evaluatorName: "Is polite", passed: true }),
      ]);

      expect(state.evaluatorScores["0:target_a"]).toEqual({
        exact: { name: "exact_match", score: 1 },
        saved: { name: "Is polite", passed: true },
      });
    });

    it("never keeps a comparison's own verdict, an error, or an unknown evaluator", () => {
      const state = progressAfter([
        started(plan),
        evaluatorResult({ evaluatorId: "judge", label: "target_a" }),
        evaluatorResult({ evaluatorId: "exact", status: "error" }),
        evaluatorResult({ evaluatorId: "gone", score: 1 }),
      ]);

      expect(state.evaluatorScores).toEqual({});
    });
  });

  describe("when cells finish", () => {
    /** @scenario "A comparison cell waits until every target cell's results are folded" */
    it("reads phase 1 as folded only once every target cell has finished", () => {
      const partly = progressAfter([started(plan), cellFinished({ ordinal: 0, phase: 1 })]);
      const whole = progressAfter([
        started(plan),
        cellFinished({ ordinal: 1, phase: 1 }),
        cellFinished({ ordinal: 0, phase: 1 }),
        cellFinished({ ordinal: 0, phase: 1 }),
      ]);

      expect(partly.phaseOneCells).toBe(2);
      expect(isPhaseOneFolded(partly)).toBe(false);
      expect(isPhaseOneFolded(whole)).toBe(true);
    });
  });
});

describe("the run's progress fold as main's poller JSON", () => {
  const finishedRun = () => [
    started({ ...plan, experimentSlug: "exp-one", runUrl: "https://app/run_1" }),
    cellFinished({ ordinal: 0, phase: 1 }),
    cellFinished({ ordinal: 1, phase: 1, outcome: "failed" }),
    cellFinished({ ordinal: 1, phase: 1, outcome: "failed" }),
    cellFinished({ ordinal: 2, phase: 2 }),
  ];

  describe("when a run starts and its cells finish", () => {
    /** @scenario "A poll reads a pipeline run's status and counts from its progress fold" */
    it("reports it running with each cell counted once, failures apart", () => {
      const state = progressAfter(finishedRun());

      expect(state).toMatchObject({
        status: "running",
        experimentSlug: "exp-one",
        total: 3,
        progress: 3,
        failed: 1,
        startedAt: 1_000,
      });
    });

    /** @scenario "A run's live frames are published from its progress fold with their seq" */
    it("numbers each frame in the run's order, and a redelivered finish streams nothing", () => {
      const state = progressAfter(finishedRun());

      expect(state.recentEvents.map(({ seq, frame }) => [seq, frame.type])).toEqual([
        [1, "execution_started"],
        [2, "progress"],
        [3, "progress"],
        [4, "progress"],
      ]);
      expect(state.seq).toBe(4);
    });
  });

  describe("when the run finishes", () => {
    it("completes with main's summary and link, and streams done", () => {
      const state = progressAfter([...finishedRun(), completed({ outcome: "finished" })]);

      expect(state.status).toBe("completed");
      expect(state.finishedAt).toBe(4_000);
      expect(state.summary).toEqual({
        runId: "run_1",
        totalCells: 3,
        completedCells: 2,
        failedCells: 1,
        duration: 3_000,
        timestamps: { startedAt: 1_000, finishedAt: 4_000 },
        runUrl: "https://app/run_1",
      });
      expect(state.recentEvents.at(-1)?.frame.type).toBe("done");
    });

    it("stays completed when a start or completion is redelivered", () => {
      const state = progressAfter([
        ...finishedRun(),
        completed({ outcome: "finished" }),
        started(plan),
        completed({ outcome: "stopped" }),
      ]);

      expect(state.status).toBe("completed");
      expect(state.seq).toBe(5);
    });
  });

  describe("when the run stops or fails", () => {
    it("reports a stop as stopped", () => {
      const state = progressAfter([started(plan), completed({ outcome: "stopped" })]);

      expect(state).toMatchObject({ status: "stopped", finishedAt: 4_000 });
    });

    it("reports a failure by its code, never a message", () => {
      const state = progressAfter([started(plan), completed({ outcome: "failed" })]);

      expect(state).toMatchObject({ status: "failed", error: "lw.unnamed_failure" });
    });
  });

  describe("when the run writes its cells back", () => {
    it("keeps each produced result's frame by its cell", () => {
      const state = progressAfter([
        started(plan),
        targetResult({ predicted: { output: "4" } }),
        evaluatorResult({ evaluatorId: "exact", score: 1 }),
        targetResult({ targetId: "target_b", predicted: { output: "x" }, carriedOver: true }),
      ]);

      expect(Object.keys(state.resultFrames)).toEqual([
        "target:0:target_a",
        "evaluator:0:target_a:exact",
      ]);
    });

    it("keeps none for a run that does not", () => {
      const state = progressAfter([
        started({ ...plan, persistResults: false }),
        targetResult({ predicted: { output: "4" } }),
      ]);

      expect(state.resultFrames).toEqual({});
    });
  });

  describe("when the fold is stored", () => {
    /** @scenario "A run's progress is read by its runId alone" */
    it("is read back by runId; another experiment's run of that id reads as empty", async () => {
      const folds = MemoryExperimentRunFoldRepository.create();
      const store = ExperimentRunProgressStore.create({ repository: folds });
      await store.store(progressAfter([started(plan)]), { aggregateId, tenantId });

      expect((await folds.readRunProgress({ runId: "run_1" })).kind).toBe("folded");
      expect((await store.get(aggregateId)).kind).toBe("folded");
      expect((await store.get("experiment_2:run_1")).kind).toBe("empty");
    });
  });
});
