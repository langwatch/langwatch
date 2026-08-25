/**
 * What actually reaches the engine when a cell runs.
 *
 * The nlpgo dispatch boundary (and env injection / dataset inlining) is mocked
 * and fed scripted server events, so these run the dispatch decision itself
 * without a live NLP service: whether the evaluator is sent at all, and which
 * dataset the inputs were resolved from.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatorConfig } from "~/experiments-v3/types";
import type { StudioServerEvent } from "~/optimization_studio/types/events";

const scripted = vi.hoisted(() => ({
  component: [] as StudioServerEvent[],
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
      for (const event of scripted.component) onEvent(event);
    },
  ),
}));
vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn(async (event: unknown) => event),
}));
vi.mock("~/optimization_studio/server/loadDatasets", () => ({
  loadDatasets: vi.fn(async (event: unknown) => event),
}));

import { executeCell, generateCells } from "../orchestrator";
import type { EvaluationV3Event, ExecutionCell } from "../types";

const datasetColumns = [
  { id: "question", name: "question", type: "string" },
  { id: "expected", name: "expected", type: "string" },
];

/** An exact-match chip whose fields are mapped, or not mapped at all. */
const gradingEvaluator = (mapped: boolean): EvaluatorConfig => ({
  id: "eval-1",
  evaluatorType: "langevals/exact_match",
  dbEvaluatorId: "db-eval-1",
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  mappings: mapped
    ? {
        "dataset-1": {
          "target-1": {
            output: {
              type: "source",
              source: "target",
              sourceId: "target-1",
              sourceField: "output",
            },
            expected_output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected",
            },
          },
        },
      }
    : {},
});

/**
 * A cell whose target output is already known, so the run under test is exactly
 * one evaluator dispatch.
 */
const makeCell = (evaluator: EvaluatorConfig): ExecutionCell => ({
  rowIndex: 0,
  targetId: "target-1",
  targetConfig: {
    id: "target-1",
    type: "prompt",
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {},
    localPromptConfig: {
      llm: { model: "openai/gpt-5-mini", temperature: 0 },
      messages: [{ role: "user", content: "{{input}}" }],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
  } as unknown as ExecutionCell["targetConfig"],
  evaluatorConfigs: [evaluator],
  datasetEntry: {
    _datasetId: "dataset-1",
    question: "is a dog an animal?",
    expected: "yes",
  },
  skipTarget: true,
  precomputedTargetOutput: { output: "yes" },
});

const run = async (cell: ExecutionCell): Promise<EvaluationV3Event[]> => {
  const events: EvaluationV3Event[] = [];
  for await (const event of executeCell(cell, "p1", datasetColumns, {})) {
    events.push(event);
  }
  return events;
};

const evaluatorDispatches = () =>
  scripted.dispatched.filter((message) => message.type === "execute_component");

beforeEach(() => {
  scripted.component = [];
  scripted.dispatched = [];
});

describe("given an evaluator attached to a target column", () => {
  describe("when none of its fields are mapped", () => {
    /** @scenario "An evaluator with no resolved inputs reports an error instead of a pass" */
    it("reports the row as an error and never calls the evaluator", async () => {
      const events = await run(makeCell(gradingEvaluator(false)));

      const results = events.filter((e) => e.type === "evaluator_result");
      expect(results).toHaveLength(1);
      expect(results[0]?.result.status).toBe("error");
      expect((results[0]?.result as { error_type?: string }).error_type).toBe(
        "NoInputsResolved",
      );
      expect(evaluatorDispatches()).toHaveLength(0);
    });

    /** @scenario "An evaluator with no resolved inputs reports an error instead of a pass" */
    it("names the evaluator and the fix in the row's details", async () => {
      const events = await run(makeCell(gradingEvaluator(false)));

      const result = events.find((e) => e.type === "evaluator_result");
      expect((result?.result as { details?: string }).details).toContain(
        "Exact Match Evaluator",
      );
      expect((result?.result as { details?: string }).details).toContain(
        "Map its fields in the evaluator settings",
      );
    });
  });

  describe("when its fields are mapped", () => {
    /** @scenario "An evaluator with no resolved inputs reports an error instead of a pass" */
    it("dispatches the evaluator with the resolved inputs", async () => {
      scripted.component = [
        {
          type: "component_state_change",
          payload: {
            component_id: "target-1.eval-1",
            execution_state: {
              status: "success",
              outputs: { score: 1, passed: true },
            },
          },
        },
      ] as unknown as StudioServerEvent[];

      const events = await run(makeCell(gradingEvaluator(true)));

      expect(evaluatorDispatches()).toHaveLength(1);
      expect(evaluatorDispatches()[0]?.payload.inputs).toEqual({
        output: "yes",
        expected_output: "yes",
      });
      const result = events.find((e) => e.type === "evaluator_result");
      expect(result?.result.status).toBe("processed");
    });
  });
});

describe("given a workbench with two datasets", () => {
  describe("when the active dataset is not the first one", () => {
    /** @scenario "The run reads its mappings from the dataset the rows come from" */
    it("dispatches the evaluator with inputs from the active dataset", async () => {
      const state = {
        datasets: [
          { id: "dataset-old", name: "Old" },
          { id: "dataset-active", name: "Active" },
        ],
        activeDatasetId: "dataset-active",
        targets: [
          {
            id: "target-1",
            type: "prompt",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              "dataset-active": {
                input: {
                  type: "source",
                  source: "dataset",
                  sourceId: "dataset-active",
                  sourceField: "question",
                },
              },
            },
            localPromptConfig: {
              llm: { model: "openai/gpt-5-mini", temperature: 0 },
              messages: [{ role: "user", content: "{{input}}" }],
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
        ],
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            dbEvaluatorId: "db-eval-1",
            inputs: [
              { identifier: "output", type: "str" },
              { identifier: "expected_output", type: "str" },
            ],
            mappings: {
              "dataset-active": {
                "target-1": {
                  output: {
                    type: "source",
                    source: "target",
                    sourceId: "target-1",
                    sourceField: "output",
                  },
                  expected_output: {
                    type: "source",
                    source: "dataset",
                    sourceId: "dataset-active",
                    sourceField: "expected",
                  },
                },
              },
            },
          },
        ],
      } as unknown as Parameters<typeof generateCells>[0];

      const cells = generateCells(
        state,
        [{ question: "is a dog an animal?", expected: "yes" }],
        { type: "full" },
      );
      const cell = {
        ...cells[0]!,
        skipTarget: true,
        precomputedTargetOutput: { output: "yes" },
      };

      scripted.component = [
        {
          type: "component_state_change",
          payload: {
            component_id: "target-1.eval-1",
            execution_state: {
              status: "success",
              outputs: { score: 1, passed: true },
            },
          },
        },
      ] as unknown as StudioServerEvent[];

      const events = await run(cell);

      expect(evaluatorDispatches()).toHaveLength(1);
      expect(evaluatorDispatches()[0]?.payload.inputs).toEqual({
        output: "yes",
        expected_output: "yes",
      });
      const result = events.find((e) => e.type === "evaluator_result");
      expect(result?.result.status).toBe("processed");
    });
  });
});
