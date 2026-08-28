/**
 * What actually reaches the engine when a cell runs.
 *
 * The nlpgo dispatch boundary (and env injection / dataset inlining) is mocked
 * and fed scripted server events, so these run the dispatch decision itself
 * without a live NLP service: whether the evaluator is sent at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatorConfig } from "~/experiments-v3/types";
import type { StudioServerEvent } from "@langwatch/workflow-contract";

vi.mock("~/app/api/workflows/post_event/post-event", async () => ({
  studioBackendPostEvent: vi.fn(
    (await import("./dispatchBoundary")).postEventToScript,
  ),
}));
vi.mock("~/optimization_studio/server/addEnvs", async () => ({
  addEnvs: vi.fn((await import("./dispatchBoundary")).leaveEventAsItIs),
}));
vi.mock("~/optimization_studio/server/loadDatasets", async () => ({
  loadDatasets: vi.fn((await import("./dispatchBoundary")).leaveEventAsItIs),
}));

import { executeCell } from "../orchestrator";
import type { EvaluationV3Event, ExecutionCell } from "../types";
import {
  datasetColumns,
  evaluatorDispatches,
  resetBoundary,
  scripted,
} from "./dispatchBoundary";

const gradingEvaluator = (isMapped: boolean): EvaluatorConfig => ({
  id: "eval-1",
  evaluatorType: "langevals/exact_match",
  dbEvaluatorId: "db-eval-1",
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  mappings: isMapped
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

/** Run one cell to its end and collect every event it produced. */
const runCell = async (cell: ExecutionCell): Promise<EvaluationV3Event[]> => {
  const events: EvaluationV3Event[] = [];
  for await (const event of executeCell(cell, "p1", datasetColumns, {})) {
    events.push(event);
  }
  return events;
};

beforeEach(resetBoundary);

describe("given an evaluator attached to a target column", () => {
  describe("when none of its fields are mapped", () => {
    /** @scenario "An evaluator with no resolved inputs reports an error instead of a pass" */
    it("reports the row as an error and never calls the evaluator", async () => {
      const events = await runCell(makeCell(gradingEvaluator(false)));

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
      const events = await runCell(makeCell(gradingEvaluator(false)));

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

      const events = await runCell(makeCell(gradingEvaluator(true)));

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

/**
 * An evaluator can also BE a column rather than a chip attached to one. That
 * column dispatches through the target path, which the chip guard never
 * reached, so an unmapped evaluator column scored empty against empty and
 * reported a pass for every row.
 */
describe("given an evaluator run as its own column", () => {
  const loadedEvaluators = new Map([
    [
      "db-eval-1",
      {
        id: "db-eval-1",
        name: "Answer Correctness",
        config: { evaluatorType: "langevals/exact_match" },
      },
    ],
  ]);

  const evaluatorColumn = (isMapped: boolean): ExecutionCell => ({
    rowIndex: 0,
    targetId: "target-eval",
    targetConfig: {
      id: "target-eval",
      type: "evaluator",
      targetEvaluatorId: "db-eval-1",
      inputs: [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
      ],
      outputs: [{ identifier: "passed", type: "bool" }],
      mappings: isMapped
        ? {
            "dataset-1": {
              output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "question",
              },
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "expected",
              },
            },
          }
        : {},
    } as unknown as ExecutionCell["targetConfig"],
    evaluatorConfigs: [],
    datasetEntry: {
      _datasetId: "dataset-1",
      question: "is a dog an animal?",
      expected: "yes",
    },
  });

  const runColumn = async (
    cell: ExecutionCell,
  ): Promise<EvaluationV3Event[]> => {
    const events: EvaluationV3Event[] = [];
    for await (const event of executeCell(cell, "p1", datasetColumns, {
      evaluators: loadedEvaluators,
    })) {
      events.push(event);
    }
    return events;
  };

  describe("when none of its fields are mapped", () => {
    /** @scenario "An evaluator column with no resolved inputs reports an error instead of passing" */
    it("reports the row as an error and never calls the evaluator", async () => {
      const events = await runColumn(evaluatorColumn(false));

      const results = events.filter((e) => e.type === "target_result");
      expect(results).toHaveLength(1);
      // The code, not the prose: the sentence the reader sees is drawn from
      // the client registry, and the evaluator's name rides in `meta` for it.
      expect(results[0]?.domainError?.code).toBe(
        "evaluator_no_inputs_resolved",
      );
      expect(results[0]?.domainError?.meta).toMatchObject({
        evaluatorName: "Answer Correctness",
      });
      expect(results[0]?.output).toBeUndefined();
      expect(evaluatorDispatches()).toHaveLength(0);
    });
  });

  describe("when its fields are mapped", () => {
    /** @scenario "An evaluator column with no resolved inputs reports an error instead of passing" */
    it("dispatches the column with the resolved inputs", async () => {
      scripted.component = [
        {
          type: "component_state_change",
          payload: {
            component_id: "target-eval",
            execution_state: {
              status: "success",
              outputs: { score: 1, passed: true },
            },
          },
        },
      ] as unknown as StudioServerEvent[];

      const events = await runColumn(evaluatorColumn(true));

      expect(evaluatorDispatches()).toHaveLength(1);
      expect(evaluatorDispatches()[0]?.payload.inputs).toEqual({
        output: "is a dog an animal?",
        expected_output: "yes",
      });
      const result = events.find((e) => e.type === "target_result");
      expect(result?.error).toBeUndefined();
    });
  });
});
