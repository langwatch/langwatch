/**
 * Which dataset a run resolves its inputs from.
 *
 * A workbench can hold several datasets and only one of them is active. The
 * mappings are per dataset, so a run that reads the first one instead of the
 * active one dispatches an evaluator with the wrong inputs. The nlpgo
 * boundary is scripted (see `dispatchBoundary.ts`), so this reads what was
 * dispatched rather than what an engine answered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioServerEvent } from "@langwatch/workflow-contract";

vi.mock("~/app/api/workflows/post_event/post-event", async () => ({
  studioBackendPostEvent: vi.fn(
    (await import("./dispatchBoundary")).postEventToScript,
  ),
}));

import { executeCell, generateCells } from "../orchestrator";
import type { EvaluationV3Event, ExecutionCell } from "../types";
import {
  datasetColumns,
  evaluatorDispatches,
  resetBoundary,
  scripted,
} from "./dispatchBoundary";

/** Run one cell to its end and collect every event it produced. */
const runCell = async (cell: ExecutionCell): Promise<EvaluationV3Event[]> => {
  const events: EvaluationV3Event[] = [];
  for await (const event of executeCell(cell, "p1", datasetColumns, {})) {
    events.push(event);
  }
  return events;
};

beforeEach(resetBoundary);

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

      const events = await runCell(cell);

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
