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

function cellFinished(data: Pick<CellFinishedEventData, "ordinal" | "phase">): CellFinishedEvent {
  return EventUtils.createEvent<CellFinishedEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.CELL_FINISHED,
    data: { ...run, ...data, outcome: "succeeded" },
    occurredAt: 3_000,
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
