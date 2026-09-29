import {
  buildIntentAccessor,
  buildProcessManager,
  createTenantId,
  type ProcessEvolution,
  type ProcessIntent,
} from "@langwatch/eventing";
import type { ExperimentRunPlan, ExperimentRunPlanCell } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import type { ExperimentRunStartedEvent } from "../experiment-run-events.process.ts";
import {
  experimentRunExecutionProcess,
  experimentRunExecutionView,
} from "../experiment-run-execution.process.ts";
import {
  EXPERIMENT_RUN_STALL_MS,
  type ExperimentRunExecutionState,
  experimentRunExecutionStateSchema,
  type ExperimentRunExecutionView,
  INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
} from "../experiment-run-execution.schemas.ts";

const definition = buildProcessManager({
  name: "experimentRunExecution",
  applier: experimentRunExecutionProcess({
    executeCell: () => Promise.resolve(),
    failCell: () => Promise.resolve(),
    complete: () => Promise.resolve(),
  }),
});

const context = (at: number) => ({
  key: "experiment_1:run_1",
  projectId: "project_alpha",
  intent: buildIntentAccessor(definition.config.intents),
  at,
  now: at,
});

function handle(
  state: ExperimentRunExecutionState,
  eventType: string,
  view: ExperimentRunExecutionView,
  at = 1_000,
): ProcessEvolution<ExperimentRunExecutionState> {
  const evolve = definition.config.handlers[eventType];
  if (!evolve) throw new Error(`no handler for ${eventType}`);
  const evolution = evolve(state, view, context(at));
  return { ...evolution, state: experimentRunExecutionStateSchema.parse(evolution.state) };
}

function plan({
  phaseOne,
  phaseTwo,
  concurrency,
}: {
  phaseOne: number;
  phaseTwo: number;
  concurrency: number;
}): ExperimentRunPlan {
  const cells: ExperimentRunPlanCell[] = [
    ...Array.from({ length: phaseOne }, (_, ordinal): ExperimentRunPlanCell => ({
      ordinal,
      phase: 1,
      rowIndex: ordinal,
      targetId: "target_a",
      evaluatorIds: [],
    })),
    ...Array.from({ length: phaseTwo }, (_, index): ExperimentRunPlanCell => ({
      ordinal: phaseOne + index,
      phase: 2,
      rowIndex: index,
      targetId: "target_a",
      evaluatorId: "judge",
    })),
  ];
  return {
    concurrency,
    origin: "workbench",
    persistResults: false,
    scope: { type: "full" },
    mappingDatasetId: "dataset_1",
    targets: [],
    evaluators: [],
    datasetColumns: [],
    rows: [],
    cells,
    pinned: { prompts: [], workflows: [] },
  };
}

function startedEvent(runPlan: ExperimentRunPlan | undefined): ExperimentRunStartedEvent {
  return {
    id: "event_1",
    aggregateId: "experiment_1:run_1",
    aggregateType: "experiment_run",
    tenantId: createTenantId("project_alpha"),
    createdAt: 1_000,
    occurredAt: 1_000,
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: {
      runId: "run_1",
      experimentId: "experiment_1",
      total: runPlan?.cells.length ?? 0,
      targets: [],
      ...(runPlan ? { plan: runPlan } : {}),
    },
  };
}

function start(runPlan: ExperimentRunPlan | undefined) {
  return handle(
    INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
    EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    experimentRunExecutionView(startedEvent(runPlan)),
  );
}

function finish(state: ExperimentRunExecutionState, ordinal: number, at = 2_000) {
  return handle(
    state,
    EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED,
    { kind: "cell_finished", ordinal },
    at,
  );
}

const sent = (intents: ProcessIntent[] | undefined, type = "executeCell") =>
  (intents ?? []).filter((intent) => intent.intentType === type).map((intent) => intent.payload);

const ordinalsSent = (intents: ProcessIntent[] | undefined, type = "executeCell") =>
  (intents ?? []).filter((intent) => intent.intentType === type).map((intent) => intent.messageKey);

describe("the run's execution manager", () => {
  describe("given a run of six cells started with a concurrency of two", () => {
    /** @scenario "The run manager sends cells up to the run's concurrency, then one per finished cell" */
    it("sends the first two cells, each carrying only its ordinal and phase", () => {
      const started = start(plan({ phaseOne: 6, phaseTwo: 0, concurrency: 2 }));

      expect(sent(started.intents)).toEqual([
        { runId: "run_1", experimentId: "experiment_1", ordinal: 0, phase: 1 },
        { runId: "run_1", experimentId: "experiment_1", ordinal: 1, phase: 1 },
      ]);
      expect(started.nextWakeAt).toBe(1_000 + EXPERIMENT_RUN_STALL_MS);
    });

    /** @scenario "The run manager sends cells up to the run's concurrency, then one per finished cell" */
    it("sends the next cell each time one finishes, and completes after the last", () => {
      let state = start(plan({ phaseOne: 6, phaseTwo: 0, concurrency: 2 })).state;
      const sentAfter: string[][] = [];
      let last: ProcessEvolution<ExperimentRunExecutionState> | undefined;
      for (const ordinal of [1, 0, 2, 3, 4, 5]) {
        last = finish(state, ordinal);
        state = last.state;
        sentAfter.push(ordinalsSent(last.intents));
      }

      expect(sentAfter).toEqual([["cell:2:1"], ["cell:3:1"], ["cell:4:1"], ["cell:5:1"], [], []]);
      expect(sent(last?.intents, "complete")).toEqual([
        { runId: "run_1", experimentId: "experiment_1", outcome: "finished", finishedCells: 6 },
      ]);
      expect(last?.nextWakeAt).toBeNull();
    });
  });

  describe("given a run with two target cells and two comparison cells", () => {
    /** @scenario "The run manager opens the comparison cells only once every target cell has finished" */
    it("holds the comparisons back until the last target cell finishes", () => {
      const started = start(plan({ phaseOne: 2, phaseTwo: 2, concurrency: 4 }));
      const firstFinished = finish(started.state, 0);
      const secondFinished = finish(firstFinished.state, 1);

      expect(ordinalsSent(started.intents)).toEqual(["cell:0:1", "cell:1:1"]);
      expect(ordinalsSent(firstFinished.intents)).toEqual([]);
      expect(ordinalsSent(secondFinished.intents)).toEqual(["cell:2:2", "cell:3:2"]);
    });
  });

  describe("given a cell whose finish is delivered twice", () => {
    /** @scenario "The run manager counts a redelivered finish once" */
    it("frees one place in the window, not two", () => {
      const started = start(plan({ phaseOne: 4, phaseTwo: 0, concurrency: 1 }));
      const once = finish(started.state, 0);
      const twice = finish(once.state, 0);

      expect(ordinalsSent(once.intents)).toEqual(["cell:1:1"]);
      expect(ordinalsSent(twice.intents)).toEqual([]);
      expect(twice.state).toEqual(once.state);
    });
  });

  describe("given a run asked to abort with a cell in flight", () => {
    /** @scenario "The run manager stops sending on abort and completes once its cells in flight finish" */
    it("sends nothing more and completes stopped when the cell in flight finishes", () => {
      const started = start(plan({ phaseOne: 4, phaseTwo: 1, concurrency: 1 }));
      const aborted = handle(started.state, EXPERIMENT_RUN_EVENT_TYPES.ABORT_REQUESTED, {
        kind: "abort_requested",
      });
      const drained = finish(aborted.state, 0);

      expect(aborted.intents ?? []).toEqual([]);
      expect(ordinalsSent(drained.intents)).toEqual([]);
      expect(sent(drained.intents, "complete")).toEqual([
        { runId: "run_1", experimentId: "experiment_1", outcome: "stopped", finishedCells: 1 },
      ]);
    });
  });

  describe("given a run where no cell finished for the stall window", () => {
    /** @scenario "The run manager fails every unfinished cell as lost after the stall window" */
    it("fails every unfinished cell, sent or not, and sends nothing more", () => {
      const started = start(plan({ phaseOne: 3, phaseTwo: 1, concurrency: 1 }));
      const onlyFirst = finish(started.state, 0, 1_500);
      const wake = definition.config.onWake;
      if (!wake) throw new Error("the manager declares no wake");

      const stalled = wake(onlyFirst.state, context(1_500 + EXPERIMENT_RUN_STALL_MS));
      const state = experimentRunExecutionStateSchema.parse(stalled.state);
      const afterLost = finish(state, 1, 1_600 + EXPERIMENT_RUN_STALL_MS);

      expect(ordinalsSent(stalled.intents, "failCell")).toEqual([
        "fail:1:1",
        "fail:2:1",
        "fail:3:2",
      ]);
      expect(ordinalsSent(afterLost.intents)).toEqual([]);
    });

    it("waits out a stall window that has not passed yet", () => {
      const started = start(plan({ phaseOne: 2, phaseTwo: 0, concurrency: 1 }));
      const wake = definition.config.onWake;
      if (!wake) throw new Error("the manager declares no wake");

      const early = wake(started.state, context(2_000));

      expect(early.intents ?? []).toEqual([]);
      expect(early.nextWakeAt).toBe(1_000 + EXPERIMENT_RUN_STALL_MS);
    });
  });

  describe("given a run started before runs carried a plan", () => {
    /** @scenario "A run started without a plan is folded but never driven" */
    it("sends no cell and arms no wake", () => {
      const started = start(undefined);

      expect(started.intents ?? []).toEqual([]);
      expect(started.nextWakeAt).toBeNull();
      expect(started.state.status).toBe("idle");
    });
  });

  describe("given a run with no cells in its plan", () => {
    it("completes at once", () => {
      const started = start(plan({ phaseOne: 0, phaseTwo: 0, concurrency: 2 }));

      expect(sent(started.intents, "complete")).toEqual([
        { runId: "run_1", experimentId: "experiment_1", outcome: "finished", finishedCells: 0 },
      ]);
    });
  });
});
