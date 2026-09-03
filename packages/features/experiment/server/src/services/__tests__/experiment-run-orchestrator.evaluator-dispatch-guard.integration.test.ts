/**
 * What actually reaches the engine when a cell runs.
 *
 * The studio boundary is a fake port fed scripted component events (the
 * platform version mocked three `~/`-rooted modules; the cell takes its
 * studio boundary as a port now, so the fake is passed in instead), so these
 * run the dispatch decision itself without a live NLP service: whether the
 * evaluator is sent at all.
 *
 * @see specs/experiments-v3/evaluation-execution.feature
 */
import type { EvaluatorConfig } from "@langwatch/experiment-contract";
import type { StudioServerEvent, WorkflowService } from "@langwatch/workflow-contract";
import { beforeEach, describe, expect, it } from "vitest";
import {
  executeCell,
  type ExperimentRunPorts,
} from "../experiment-run-orchestrator.service";
import type { EvaluationV3Event, ExecutionCell } from "@langwatch/experiment-contract";

const scripted: {
  component: StudioServerEvent[];
  dispatched: Array<{ type: string; payload: Record<string, any> }>;
} = { component: [], dispatched: [] };

const resetBoundary = () => {
  scripted.component = [];
  scripted.dispatched = [];
};

const datasetColumns = [
  { id: "question", name: "question", type: "string" },
  { id: "expected", name: "expected", type: "string" },
];

const ports = {
  studio: {
    postEvent: async ({
      event,
      onEvent,
    }: {
      event: { type: string; payload: Record<string, any> };
      onEvent: (event: StudioServerEvent) => void;
    }) => {
      scripted.dispatched.push(event);
      for (const serverEvent of scripted.component) onEvent(serverEvent);
    },
  },
} as unknown as ExperimentRunPorts;

const workflows = {
  enrichStudioEvent: async ({ event }: { event: unknown }) => event,
  prepareStudioEvent: async ({ event }: { event: unknown }) => event,
} as unknown as WorkflowService;

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
  for await (const event of executeCell(cell, "p1", ports, datasetColumns, {}, workflows)) {
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
      expect(scripted.dispatched).toHaveLength(0);
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

      expect(scripted.dispatched).toHaveLength(1);
      expect(scripted.dispatched[0]?.payload.inputs).toEqual({
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

  const runColumn = async (cell: ExecutionCell): Promise<EvaluationV3Event[]> => {
    const events: EvaluationV3Event[] = [];
    for await (const event of executeCell(
      cell,
      "p1",
      ports,
      datasetColumns,
      { evaluators: loadedEvaluators },
      workflows,
    )) {
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
      expect(results[0]?.domainError?.code).toBe("evaluator_no_inputs_resolved");
      expect(results[0]?.domainError?.meta).toMatchObject({
        evaluatorName: "Answer Correctness",
      });
      expect(results[0]?.output).toBeUndefined();
      expect(scripted.dispatched).toHaveLength(0);
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

      expect(scripted.dispatched).toHaveLength(1);
      expect(scripted.dispatched[0]?.payload.inputs).toEqual({
        output: "is a dog an animal?",
        expected_output: "yes",
      });
      const result = events.find((e) => e.type === "target_result");
      expect(result?.error).toBeUndefined();
    });
  });
});
