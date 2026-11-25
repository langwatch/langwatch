/**
 * A repeated run's plan: every dataset row laid out `repeat` times, dataset row by dataset row.
 * @see specs/experiments-v3/run-repeat.feature
 */
import type { ExecutionScope, TargetConfig } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import {
  repeatedRows,
  repeatedScope,
  runRepeatOf,
} from "../../../../rules/experiment-execution-data.rules.ts";
import { ExperimentRunPlanService } from "../experiment-run-plan.service.ts";

const promptTarget: TargetConfig = {
  id: "target_a",
  type: "prompt",
  promptId: "prompt_a",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
};

const datasetRows = [{ question: "What is 2 + 2?" }, { question: "What is 3 + 3?" }];

function repeatedPlan({ scope, repeat }: { scope: ExecutionScope; repeat: number }) {
  return ExperimentRunPlanService.create().buildPlan({
    request: {
      state: {
        datasets: [
          {
            id: "dataset_1",
            name: "dataset_1",
            type: "inline",
            columns: [{ id: "question", name: "question", type: "string" }],
          },
        ],
        activeDatasetId: "dataset_1",
        targets: [promptTarget],
        evaluators: [],
      },
      scope: repeatedScope({ scope, repeat }),
    },
    data: {
      datasetRows: repeatedRows({ rows: datasetRows, repeat }),
      datasetColumns: [{ id: "question", name: "question", type: "string" }],
      loadedPrompts: new Map([["prompt_a@latest", { id: "prompt_a", version: 1 }]]),
      loadedWorkflows: new Map(),
    },
    concurrency: 4,
    repeat,
    origin: "saved",
    persistResults: false,
  });
}

describe("a repeated run's plan", () => {
  describe("given a full run of two dataset rows with a repeat of 3", () => {
    /** @scenario "A repeated run plans every dataset row that many times" */
    it("plans six cells, the first three on dataset row 1 and the last three on dataset row 2", () => {
      const plan = repeatedPlan({ scope: { type: "full" }, repeat: 3 });

      expect(plan.cells.map((cell) => cell.rowIndex)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(plan.rows.map((row) => row.entry)).toEqual([
        datasetRows[0],
        datasetRows[0],
        datasetRows[0],
        datasetRows[1],
        datasetRows[1],
        datasetRows[1],
      ]);
    });

    /** @scenario "A repeated run plans every dataset row that many times" */
    it("records the repeat on the plan", () => {
      expect(repeatedPlan({ scope: { type: "full" }, repeat: 3 }).repeat).toBe(3);
    });
  });

  describe("given a run over dataset row 2 only with a repeat of 2", () => {
    /** @scenario "A repeated run over chosen rows repeats only those rows" */
    it("plans run rows 3 and 4 only", () => {
      const plan = repeatedPlan({ scope: { type: "rows", rowIndices: [1] }, repeat: 2 });

      expect(plan.cells.map((cell) => cell.rowIndex)).toEqual([2, 3]);
    });
  });

  describe("given a repeat of 1", () => {
    /** @scenario "A run call with a repeat of 1 runs every row once, as before" */
    it("records no repeat", () => {
      expect(runRepeatOf(1)).toBe(1);
      expect(runRepeatOf(undefined)).toBe(1);
      expect(repeatedPlan({ scope: { type: "full" }, repeat: 1 }).repeat).toBeUndefined();
    });
  });
});
