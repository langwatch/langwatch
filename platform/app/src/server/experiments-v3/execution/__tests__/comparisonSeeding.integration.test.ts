/**
 * @vitest-environment node
 *
 * @see specs/experiments-v3/evaluation-execution.feature
 *
 * What a run that covers ONE candidate does about the columns its comparison
 * also reads. In production the assistant ran the candidate alone, the judge
 * found no output for the baseline, and every row of the comparison came back
 * "Waiting on category_classifier (1)" over verdicts nobody asked to re-run.
 *
 * The nlpgo dispatch boundary and the storage commands are mocked, so this runs
 * the planning and the phase split without a live engine or a datastore.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EvaluationsV3State,
  EvaluatorConfig,
  TargetConfig,
} from "~/experiments-v3/types";
import {
  createInitialResults,
  createInitialUIState,
} from "~/experiments-v3/types";
import type { StudioServerEvent } from "~/optimization_studio/types/events";

const scripted = vi.hoisted(() => ({
  dispatched: [] as Array<{ type: string; payload: Record<string, any> }>,
}));

vi.mock("~/app/api/workflows/post_event/post-event", () => ({
  studioBackendPostEvent: vi.fn(
    async ({
      message,
      onEvent,
    }: {
      message: { type: string; payload: Record<string, any> };
      onEvent: (event: StudioServerEvent) => void;
    }) => {
      scripted.dispatched.push(message);
      const nodeId = message.payload.node_id as string;
      onEvent({
        type: "component_state_change",
        payload: {
          component_id: nodeId,
          execution_state: {
            status: "success",
            outputs: nodeId.includes(".")
              ? { label: "candidate", score: 1, passed: true }
              : { output: `output of ${nodeId}` },
          },
        },
      } as unknown as StudioServerEvent);
    },
  ),
}));
vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn(async (event: unknown) => event),
}));
vi.mock("~/optimization_studio/server/loadDatasets", () => ({
  loadDatasets: vi.fn(async (event: unknown) => event),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    experimentRuns: {
      startExperimentRun: vi.fn().mockResolvedValue(undefined),
      recordTargetResult: vi.fn().mockResolvedValue(undefined),
      recordEvaluatorResult: vi.fn().mockResolvedValue(undefined),
    },
    evaluations: { reportEvaluation: vi.fn().mockResolvedValue(undefined) },
  }),
}));
vi.mock("../abortManager", () => ({
  abortManager: {
    setRunning: vi.fn().mockResolvedValue(undefined),
    clearRunning: vi.fn().mockResolvedValue(undefined),
    clearAbort: vi.fn().mockResolvedValue(undefined),
    requestAbort: vi.fn().mockResolvedValue(undefined),
    isAborted: vi.fn().mockResolvedValue(false),
  },
}));

import type { OrchestratorInput } from "../orchestrator";
import { runOrchestrator } from "../orchestrator";
import type { EvaluationV3Event } from "../types";

const promptTarget = (id: string): TargetConfig =>
  ({
    id,
    type: "prompt",
    promptId: `prompt-${id}`,
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      "ds-1": {
        input: {
          type: "source",
          source: "dataset",
          sourceId: "ds-1",
          sourceField: "input",
        },
      },
    },
    localPromptConfig: {
      llm: { model: "openai/gpt-5-mini", temperature: 0 },
      messages: [{ role: "user", content: "{{input}}" }],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
  }) as unknown as TargetConfig;

const comparisonChip = (): EvaluatorConfig =>
  ({
    id: "evaluator_compare",
    evaluatorType: "langevals/select_best_compare",
    dbEvaluatorId: "db-compare-1",
    inputs: [],
    mappings: {},
    comparison: {
      variants: ["baseline", "candidate"],
      hasGoldenAnswer: true,
      goldenField: "expected_output",
      includeMetrics: [],
      randomizeOrder: false,
    },
  }) as unknown as EvaluatorConfig;

const state = (): EvaluationsV3State =>
  ({
    name: "Comparison",
    activeDatasetId: "ds-1",
    datasets: [
      {
        id: "ds-1",
        name: "Data",
        type: "inline",
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "expected_output", name: "expected_output", type: "string" },
        ],
      },
    ],
    targets: [promptTarget("baseline"), promptTarget("candidate")],
    evaluators: [comparisonChip()],
    results: createInitialResults(),
    pendingSavedChanges: {},
    ui: createInitialUIState(),
  }) as unknown as EvaluationsV3State;

const datasetRows = [{ input: "one", expected_output: "1" }];

const runCandidateOnly = async (
  seedTargetOutputs?: Record<
    string,
    { output: unknown; cost?: number; duration?: number }
  >,
): Promise<EvaluationV3Event[]> => {
  const events: EvaluationV3Event[] = [];
  const input: OrchestratorInput = {
    projectId: "project-1",
    runId: "run-1",
    scope: { type: "target", targetId: "candidate" },
    state: state(),
    datasetRows,
    datasetColumns: [
      { id: "input", name: "input", type: "string" },
      { id: "expected_output", name: "expected_output", type: "string" },
    ],
    loadedPrompts: new Map(),
    loadedAgents: new Map(),
    defaultConcurrency: 10,
    loadedEvaluators: new Map([
      [
        "db-compare-1",
        {
          id: "db-compare-1",
          name: "Comparison",
          config: { evaluatorType: "langevals/select_best_compare" },
        },
      ],
    ]),
    ...(seedTargetOutputs ? { seedTargetOutputs } : {}),
  };
  for await (const event of runOrchestrator(input)) {
    events.push(event as EvaluationV3Event);
    if (event.type === "done" || event.type === "stopped") break;
  }
  return events;
};

const verdicts = (events: EvaluationV3Event[]) =>
  events.filter(
    (
      event,
    ): event is Extract<EvaluationV3Event, { type: "evaluator_result" }> =>
      event.type === "evaluator_result",
  );

const ranTargets = (events: EvaluationV3Event[]) =>
  events
    .filter((event) => event.type === "target_result")
    .map((event) => (event as { targetId: string }).targetId);

beforeEach(() => {
  scripted.dispatched = [];
});

describe("given a chip comparison over a baseline and a candidate", () => {
  describe("when only the candidate is run and the baseline's output is seeded", () => {
    /** @scenario "Running one candidate keeps the comparison's other columns" */
    it("judges the row instead of reporting a variant it is waiting on", async () => {
      const events = await runCandidateOnly({
        "0:baseline": { output: "baseline answer", cost: 0.01, duration: 100 },
      });

      const results = verdicts(events);
      expect(results).toHaveLength(1);
      expect(results[0]?.evaluatorId).toBe("evaluator_compare");
      // The verdict hangs under the first variant's column.
      expect(results[0]?.targetId).toBe("baseline");
      expect(
        (results[0]?.result as { error_type?: string }).error_type,
      ).toBeUndefined();
    });

    /** @scenario "Running one candidate keeps the comparison's other columns" */
    it("does not run the seeded column again", async () => {
      const events = await runCandidateOnly({
        "0:baseline": { output: "baseline answer" },
      });

      expect(ranTargets(events)).toEqual(["candidate"]);
    });
  });

  describe("when only the candidate is run and the baseline has no saved output", () => {
    /** @scenario "Running one candidate keeps the comparison's other columns" */
    it("runs the baseline as well, so the judge has both candidates", async () => {
      const events = await runCandidateOnly();

      expect(ranTargets(events).sort()).toEqual(["baseline", "candidate"]);
      const results = verdicts(events);
      expect(results).toHaveLength(1);
      expect(
        (results[0]?.result as { error_type?: string }).error_type,
      ).toBeUndefined();
    });
  });
});
