import { createApiFixture } from "@langwatch/api-fixture";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import {
  COMPARISON_EVALUATOR_TYPE,
  type EvaluatorConfig,
  type ExperimentRunPlan,
} from "@langwatch/experiment-contract";
import type { StudioServerEvent, WorkflowApi } from "@langwatch/workflow-contract";
/**
 * One cell of a pipeline-driven run: what it reads from the run's folds, and what it appends.
 * @see modules/experiment/specs/experiment-run-loop.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { experimentRunEventStreamChannels } from "../../channels/experiment-run-event-stream-channels.registry.ts";
import type { ExperimentRunStreamMessage } from "../../channels/experiment-run-event-stream.channel.ts";
import type { ExperimentRunProgressState } from "../../repositories/experiment-run-fold.repository.ts";
import { MemoryExperimentRunAbortRepository } from "../../repositories/memory/memory.experiment-run-abort.repository.ts";
import { MemoryExperimentRunFoldRepository } from "../../repositories/memory/memory.experiment-run-fold.repository.ts";
import type { ExperimentRunCollaborators } from "../../rules/experiment-run-input.rules.ts";
import { foldEvaluatorsOf } from "../../rules/experiment-run-plan.rules.ts";
import { markFinished } from "../../rules/experiment-run-window.rules.ts";
import type { ExecutionDataServices } from "../experiment-execution-data.service.ts";
import {
  type ExperimentCellRequest,
  ExperimentRunCellService,
} from "../experiment-run-cell.service.ts";
import { createNoAttachmentsFixture } from "./experiment-attachments.fixture.ts";

const runKey = "experiment_1:run_1";

const target = (id: string) => ({
  id,
  type: "prompt" as const,
  inputs: [{ identifier: "input", type: "str" as const }],
  outputs: [{ identifier: "output", type: "str" as const }],
  mappings: {
    dataset_1: {
      input: {
        type: "source" as const,
        source: "dataset" as const,
        sourceId: "dataset_1",
        sourceField: "question",
      },
    },
  },
  localPromptConfig: {
    llm: { model: "openai/gpt-5-mini", temperature: 0 },
    messages: [{ role: "user" as const, content: "{{input}}" }],
    inputs: [{ identifier: "input", type: "str" as const }],
    outputs: [{ identifier: "output", type: "str" as const }],
  },
});

const exactMatch: EvaluatorConfig = {
  id: "exact",
  evaluatorType: "langevals/exact_match",
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  mappings: {
    dataset_1: {
      target_a: {
        output: { type: "source", source: "target", sourceId: "target_a", sourceField: "output" },
        expected_output: {
          type: "source",
          source: "dataset",
          sourceId: "dataset_1",
          sourceField: "expected",
        },
      },
    },
  },
};

const judge = (variants: string[]): EvaluatorConfig => ({
  id: "judge",
  evaluatorType: COMPARISON_EVALUATOR_TYPE,
  inputs: [],
  mappings: {},
  comparison: {
    variants,
    hasGoldenAnswer: false,
    goldenField: "",
    includeMetrics: [],
    randomizeOrder: false,
  },
});

function planWith({
  evaluators = [exactMatch, judge(["target_a", "target_b"])],
  targets = [target("target_a"), target("target_b")],
}: {
  evaluators?: EvaluatorConfig[];
  targets?: ExperimentRunPlan["targets"];
} = {}): ExperimentRunPlan {
  return {
    concurrency: 2,
    origin: "workbench",
    persistResults: true,
    scope: { type: "full" },
    mappingDatasetId: "dataset_1",
    targets,
    evaluators,
    datasetColumns: [
      { id: "question", name: "question", type: "string" },
      { id: "expected", name: "expected", type: "string" },
    ],
    rows: [{ rowIndex: 0, entry: { question: "What is 2 + 2?", expected: "4" } }],
    cells: [
      { ordinal: 0, phase: 1, rowIndex: 0, targetId: "target_a", evaluatorIds: ["exact"] },
      { ordinal: 1, phase: 1, rowIndex: 0, targetId: "target_b", evaluatorIds: [] },
      { ordinal: 2, phase: 2, rowIndex: 0, targetId: "target_a", evaluatorId: "judge" },
    ],
    pinned: { prompts: [], workflows: [] },
  };
}

/** What the engine answers per node it is sent, and every node it was sent. */
const engine: { answers: Map<string, StudioServerEvent>; dispatched: string[] } = {
  answers: new Map(),
  dispatched: [],
};

function succeeds(nodeId: string, outputs: Record<string, unknown>, cost?: number): void {
  engine.answers.set(nodeId, {
    type: "component_state_change",
    payload: {
      component_id: nodeId,
      execution_state: { status: "success", outputs, ...(cost === undefined ? {} : { cost }) },
    },
  });
}

function fails(nodeId: string, error: string): void {
  engine.answers.set(nodeId, {
    type: "component_state_change",
    payload: { component_id: nodeId, execution_state: { status: "error", error } },
  });
}

const reported: string[] = [];

function compose() {
  const folds = MemoryExperimentRunFoldRepository.create();
  const abort = MemoryExperimentRunAbortRepository.create();
  const collaborators = createApiFixture<ExperimentRunCollaborators>(
    {
      abort,
      attachments: createNoAttachmentsFixture(),
      evaluationReporting: createApiFixture<Pick<EvaluationApi, "reportEvaluation">>({
        reportEvaluation: async ({ evaluatorId }) => {
          reported.push(evaluatorId);
        },
      }),
      studio: {
        postStudioEvent: async ({ event, onEvent }) => {
          const nodeId = "node_id" in event.payload ? String(event.payload.node_id) : "";
          engine.dispatched.push(nodeId);
          const answer = engine.answers.get(nodeId);
          if (answer) onEvent(answer);
        },
      },
    },
    "collaborators",
  );
  const stream = experimentRunEventStreamChannels.memory.create();
  const cells = ExperimentRunCellService.create({
    folds,
    stream,
    collaborators,
    services: createApiFixture<ExecutionDataServices>(
      {
        prompts: createApiFixture<ExecutionDataServices["prompts"]>({
          findByIdOrHandle: async () => null,
        }),
      },
      "services",
    ),
    workflows: createApiFixture<WorkflowApi>({
      enrichStudioEvent: async ({ event }) => event,
      prepareStudioEvent: async ({ event }) => event,
    }),
  });

  return { folds, abort, cells, stream };
}

async function planned(folds: MemoryExperimentRunFoldRepository, plan = planWith()) {
  await folds.writePlan({
    runKey,
    state: {
      projectId: "project_alpha",
      runId: "run_1",
      experimentId: "experiment_1",
      plan,
      CreatedAt: 0,
      UpdatedAt: 0,
      LastEventOccurredAt: 0,
    },
  });
}

function progress(overrides: Partial<ExperimentRunProgressState> = {}): ExperimentRunProgressState {
  return {
    projectId: "project_alpha",
    runId: "run_1",
    experimentId: "experiment_1",
    planned: true,
    phaseOneCells: 2,
    evaluators: foldEvaluatorsOf(planWith()),
    finishedCells: markFinished({
      bitmap: markFinished({ bitmap: "", ordinal: 0 }),
      ordinal: 1,
    }),
    targetOutputs: {
      "0:target_a": { output: { output: "4" } },
      "0:target_b": { output: { output: "four" } },
    },
    traceIds: { "0:target_a": "trace_a" },
    evaluatorScores: {},
    experimentSlug: "experiment-one",
    status: "running",
    progress: 2,
    total: 3,
    startedAt: 0,
    recentEvents: [],
    seq: 0,
    failed: 0,
    persistResults: false,
    resultFrames: {},
    CreatedAt: 0,
    UpdatedAt: 0,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}

const request = (ordinal: number, phase: 1 | 2): ExperimentCellRequest => ({
  projectId: "project_alpha",
  runId: "run_1",
  experimentId: "experiment_1",
  ordinal,
  phase,
});

beforeEach(() => {
  engine.answers.clear();
  engine.dispatched = [];
  reported.length = 0;
});

describe("ExperimentRunCellService", () => {
  describe("given a target cell", () => {
    describe("when the engine answers its target and its evaluator", () => {
      /** @scenario "A cell reads its row, target and evaluators from the run's plan fold" */
      it("runs the planned target, then its evaluator, and appends both results", async () => {
        const { folds, cells } = compose();
        await planned(folds);
        succeeds("target_a", { output: "4" });
        succeeds("target_a.exact", { passed: true, score: 1 });

        const executed = await cells.execute(request(0, 1));

        expect(executed.outcome).toBe("succeeded");
        expect(engine.dispatched).toEqual(["target_a", "target_a.exact"]);
        expect(executed.results.map((result) => result.kind)).toEqual(["target", "evaluator"]);
        expect(executed.results[0]?.data).toMatchObject({
          tenantId: "project_alpha",
          runId: "run_1",
          index: 0,
          targetId: "target_a",
          entry: { question: "What is 2 + 2?", expected: "4" },
          predicted: { output: "4" },
        });
        expect(executed.results[1]?.data).toMatchObject({
          evaluatorId: "exact",
          status: "processed",
          passed: true,
        });
        expect(reported).toEqual(["exact"]);
      });
    });

    describe("when it starts after the run's fold has numbered its frames", () => {
      /** @scenario "A cell's start is published on the run's channel with the last folded seq" */
      it("publishes cell_started on the run's channel with the last folded seq, appending nothing for it", async () => {
        const { folds, cells, stream } = compose();
        await planned(folds);
        await folds.writeProgress({ state: progress({ seq: 7 }) });
        succeeds("target_a", { output: "4" });
        succeeds("target_a.exact", { passed: true, score: 1 });
        const heard: ExperimentRunStreamMessage[] = [];
        await stream.subscribe({ runId: "run_1", onMessage: (message) => heard.push(message) });

        const executed = await cells.execute(request(0, 1));

        expect(heard).toEqual([
          { seq: 7, frame: { type: "cell_started", rowIndex: 0, targetId: "target_a" } },
        ]);
        expect(executed.results.map((result) => result.kind)).toEqual(["target", "evaluator"]);
      });
    });

    describe("when its evaluator spends or fails", () => {
      /** @scenario "A verdict carries every detail its frame showed" */
      it("keeps a scored verdict's cost currency, and a failed one's error type and trace", async () => {
        const { folds, cells } = compose();
        await planned(folds);
        succeeds("target_a", { output: "4" });
        succeeds("target_a.exact", { passed: true }, 0.002);

        const scored = await cells.execute(request(0, 1));
        fails("target_a.exact", "judge crashed");
        const failed = await cells.execute(request(0, 1));

        expect(scored.results[1]?.data).toMatchObject({ cost: 0.002, costCurrency: "USD" });
        expect(failed.results[1]?.data).toMatchObject({
          evaluatorId: "exact",
          status: "error",
          errorType: "EvaluatorError",
          traceback: [],
        });
      });
    });

    describe("when its target fails", () => {
      /** @scenario "A cell whose target fails finishes failed with the target's error" */
      it("finishes failed with the target's error recorded and no evaluator run", async () => {
        const { folds, cells } = compose();
        await planned(folds);
        fails("target_a", "model refused");

        const executed = await cells.execute(request(0, 1));

        expect(executed.outcome).toBe("failed");
        expect(engine.dispatched).toEqual(["target_a"]);
        expect(executed.results).toHaveLength(1);
        expect(executed.results[0]?.data).toMatchObject({ targetId: "target_a" });
        expect(executed.results[0]?.data).toHaveProperty("error");
      });
    });

    describe("when its saved prompt was removed since the run started", () => {
      /** @scenario "A cell whose target was removed since the run started fails, not the run" */
      it("finishes failed with the input error's code and appends no result", async () => {
        const { folds, cells } = compose();
        await planned(
          folds,
          planWith({ targets: [{ ...target("target_a"), promptId: "prompt_gone" }] }),
        );

        const executed = await cells.execute(request(0, 1));

        expect(executed).toMatchObject({
          outcome: "failed",
          error: { code: "experiment_evaluation_reference_not_found" },
          results: [],
        });
        expect(engine.dispatched).toEqual([]);
      });
    });

    describe("when its run was aborted", () => {
      /** @scenario "An aborted run's cell stops without running" */
      it("finishes stopped without reading the plan or dispatching", async () => {
        const { abort, cells } = compose();
        await abort.requestAbort("run_1");

        const executed = await cells.execute(request(0, 1));

        expect(executed).toEqual({ outcome: "stopped", results: [] });
        expect(engine.dispatched).toEqual([]);
      });
    });

    describe("when the run's plan is not folded yet", () => {
      it("throws, so the queue retries the cell", async () => {
        const { cells } = compose();

        await expect(cells.execute(request(0, 1))).rejects.toThrow("no plan folded yet");
      });
    });

    describe("when another project names the run", () => {
      it("refuses to run it", async () => {
        const { folds, cells } = compose();
        await planned(folds);

        await expect(
          cells.execute({ ...request(0, 1), projectId: "project_beta" }),
        ).rejects.toThrow("another project");
        expect(engine.dispatched).toEqual([]);
      });
    });
  });

  describe("given a comparison cell", () => {
    describe("when every variant produced an output", () => {
      /** @scenario "A comparison cell reads its row's variant outputs from the run's fold" */
      it("judges the row from the folded outputs without re-running a target", async () => {
        const { folds, cells } = compose();
        await planned(folds);
        await folds.writeProgress({ state: progress() });
        succeeds("target_a.judge", { label: "target_a" });

        const executed = await cells.execute(request(2, 2));

        expect(executed.outcome).toBe("succeeded");
        expect(engine.dispatched).toEqual(["target_a.judge"]);
        expect(executed.results.map((result) => result.kind)).toEqual(["evaluator"]);
        expect(executed.results[0]?.data).toMatchObject({
          targetId: "target_a",
          evaluatorId: "judge",
          label: "target_a",
        });
      });
    });

    describe("when a variant produced no output", () => {
      /** @scenario "A comparison cell whose variant has no output finishes skipped with the reason" */
      it("finishes skipped with the reason in its verdict column", async () => {
        const { folds, cells } = compose();
        await planned(folds);
        await folds.writeProgress({
          state: progress({ targetOutputs: { "0:target_a": { output: { output: "4" } } } }),
        });

        const executed = await cells.execute(request(2, 2));

        expect(executed.outcome).toBe("skipped");
        expect(engine.dispatched).toEqual([]);
        expect(executed.results).toHaveLength(1);
        expect(executed.results[0]?.data).toMatchObject({
          targetId: "target_a",
          evaluatorId: "judge",
          status: "error",
        });
      });
    });

    describe("when the comparison could not be built at start", () => {
      /** @scenario "A comparison that cannot be built finishes skipped without waiting" */
      it("finishes skipped with the reason, reading no progress", async () => {
        const { folds, cells } = compose();
        const plan = planWith({ evaluators: [exactMatch, judge(["target_a"])] });
        await planned(folds, {
          ...plan,
          cells: plan.cells.map((cell) =>
            cell.phase === 2
              ? { ...cell, setupSkip: { kind: "too-few-variants", variantNames: [] } }
              : cell,
          ),
        });

        const executed = await cells.execute(request(2, 2));

        expect(executed.outcome).toBe("skipped");
        expect(executed.results[0]?.data).toMatchObject({ evaluatorId: "judge", status: "error" });
      });
    });

    describe("when a target cell's results are not folded yet", () => {
      /** @scenario "A comparison cell waits until every target cell's results are folded" */
      it("throws, so the queue retries it once the fold catches up", async () => {
        const { folds, cells } = compose();
        await planned(folds);
        await folds.writeProgress({
          state: progress({ finishedCells: markFinished({ bitmap: "", ordinal: 0 }) }),
        });

        await expect(cells.execute(request(2, 2))).rejects.toThrow("not folded yet");
        expect(engine.dispatched).toEqual([]);
      });
    });
  });
});
