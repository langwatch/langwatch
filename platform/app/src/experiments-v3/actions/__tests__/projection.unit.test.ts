import { describe, expect, it } from "vitest";
import type {
  DatasetReference,
  EvaluationResults,
  EvaluatorConfig,
  TargetConfig,
} from "../../types";
import { PROJECTION_BUDGET_BYTES, projectWorkbenchState } from "../projection";
import type { WorkbenchState } from "../transforms";

const dataset = (): DatasetReference => ({
  id: "ds-1",
  name: "Test Data",
  type: "inline",
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
  inline: {
    columns: [
      { id: "input", name: "input", type: "string" },
      { id: "expected_output", name: "expected_output", type: "string" },
    ],
    records: {
      input: ["one", "two", "three", "four"],
      expected_output: ["1", "2", "3", "4"],
    },
  },
});

const target = (): TargetConfig => ({
  id: "target-a",
  type: "prompt",
  promptId: "prompt-1",
  promptVersionNumber: 2,
  localPromptConfig: {
    llm: { model: "openai/gpt-5-mini" },
    messages: [{ role: "user", content: "Answer {{input}}" }],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  },
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
});

const evaluator = (): EvaluatorConfig => ({
  id: "evaluator_1",
  evaluatorType: "langevals/exact_match",
  dbEvaluatorId: "db-evaluator-1",
  inputs: [{ identifier: "output", type: "str" }],
  mappings: {
    "ds-1": {
      "target-a": {
        output: {
          type: "source",
          source: "target",
          sourceId: "target-a",
          sourceField: "output",
        },
      },
    },
  },
});

const baseState = (): WorkbenchState => ({
  name: "My Evaluation",
  activeDatasetId: "ds-1",
  datasets: [dataset()],
  targets: [target()],
  evaluators: [evaluator()],
});

const utf8Bytes = (text: string): number =>
  new TextEncoder().encode(text).length;

/** What the budget counts: the UTF-8 size of the serialized projection. */
const serializedBytes = (value: unknown): number =>
  utf8Bytes(JSON.stringify(value));

const results = (): EvaluationResults => ({
  runId: "run-1",
  status: "success",
  targetOutputs: { "target-a": ["a", "b", "c", "d"] },
  targetMetadata: {
    "target-a": [
      { cost: 0.01, duration: 100 },
      { cost: 0.03, duration: 300 },
      { cost: 0.02, duration: 200 },
      { cost: 0.02, duration: 200 },
    ],
  },
  evaluatorResults: {
    "target-a": {
      evaluator_1: [
        { status: "processed", passed: true, score: 1 },
        { status: "processed", passed: false, score: 0 },
        { status: "processed", passed: true, score: 1 },
        { status: "error", details: "boom" },
      ],
    },
  },
  errors: { "target-a": [null, null, null, "boom"] },
});

describe("projectWorkbenchState", () => {
  describe("given state without results", () => {
    const projection = projectWorkbenchState({ state: baseState() });

    it("names the datasets, their columns and their row counts", () => {
      expect(projection.datasets).toEqual([
        {
          id: "ds-1",
          name: "Test Data",
          type: "inline",
          columns: [
            { id: "input", name: "input", type: "string" },
            {
              id: "expected_output",
              name: "expected_output",
              type: "string",
            },
          ],
          rowCount: 4,
          sampleRows: [
            { input: "one", expected_output: "1" },
            { input: "two", expected_output: "2" },
            { input: "three", expected_output: "3" },
          ],
        },
      ]);
    });

    it("reports the target's draft, model and wiring", () => {
      expect(projection.targets).toEqual([
        {
          id: "target-a",
          type: "prompt",
          promptId: "prompt-1",
          promptVersionNumber: 2,
          hasDraft: true,
          model: "openai/gpt-5-mini",
          inputs: ["input"],
          outputs: ["output"],
          mappings: target().mappings,
        },
      ]);
    });

    it("reports the evaluators", () => {
      expect(projection.evaluators).toEqual([
        {
          id: "evaluator_1",
          evaluatorType: "langevals/exact_match",
          dbEvaluatorId: "db-evaluator-1",
          inputs: ["output"],
          mappings: evaluator().mappings,
        },
      ]);
    });

    it("leaves results out", () => {
      expect(projection.results).toBeUndefined();
      expect(projection.truncated).toBeUndefined();
    });
  });

  describe("given state with results", () => {
    it("summarizes each target, and names the run", () => {
      const projection = projectWorkbenchState({
        state: baseState(),
        results: results(),
      });

      expect(projection.results?.runId).toBe("run-1");
      expect(projection.results?.status).toBe("success");
      expect(projection.results?.targets[0]).toEqual({
        targetId: "target-a",
        completedRows: 4,
        errorRows: 1,
        overallPassRate: (2 / 3) * 100,
        overallAverageScore: 2 / 3,
        averageCost: 0.02,
        totalCost: 0.08,
        averageLatency: 200,
      });
    });
  });

  describe("when the projection does not fit the budget", () => {
    // Sample cells are capped at 200 characters, so one dataset can never
    // overflow on its own — a workbench with many datasets can.
    const bigState = (): WorkbenchState => {
      const state = baseState();
      const rows = Array.from({ length: 4 }, (_, i) => `row ${i} `.repeat(60));
      state.datasets = Array.from({ length: 40 }, (_, i) => {
        const copy = dataset();
        copy.id = `ds-${i}`;
        copy.inline!.records = { input: rows, expected_output: rows };
        return copy;
      });
      return state;
    };

    /** @scenario "The state an assistant reads stays small" */
    it("drops the sample rows first and says it truncated", () => {
      const projection = projectWorkbenchState({ state: bigState() });

      expect(projection.truncated).toBe(true);
      expect(projection.datasets[0]!.sampleRows).toBeUndefined();
      // Mappings survive: only the free-text sample went.
      expect(projection.targets[0]!.mappings).toBeDefined();
      expect(serializedBytes(projection)).toBeLessThanOrEqual(
        PROJECTION_BUDGET_BYTES,
      );
    });

    it("collapses mappings to counts when dropping samples is not enough", () => {
      const state = baseState();
      // Enough wiring that the mappings alone overflow the budget.
      state.targets = Array.from(
        { length: 400 },
        (_, i): TargetConfig => ({
          ...target(),
          id: `target-${i}`,
          mappings: {
            "ds-1": {
              input: {
                type: "source",
                source: "dataset",
                sourceId: "ds-1",
                sourceField: "input",
              },
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "ds-1",
                sourceField: "expected_output",
              },
            },
          },
        }),
      );

      const projection = projectWorkbenchState({ state });

      expect(projection.truncated).toBe(true);
      expect(projection.targets[0]!.mappings).toBeUndefined();
      expect(projection.targets[0]!.mappingCount).toBe(2);
      expect(projection.evaluators[0]!.mappingCount).toBe(1);
    });

    /** @scenario "The state an assistant reads never exceeds the budget" */
    it("drops whole entries when collapsing every detail is not enough", () => {
      const state = baseState();
      state.targets = Array.from(
        { length: 2_000 },
        (_, index): TargetConfig => ({ ...target(), id: `target-${index}` }),
      );

      const projection = projectWorkbenchState({ state });

      expect(serializedBytes(projection)).toBeLessThanOrEqual(
        PROJECTION_BUDGET_BYTES,
      );
      expect(projection.targets.length).toBeLessThan(2_000);
      expect(projection.omittedTargets).toBe(2_000 - projection.targets.length);
      // The entries that survive are the head of the list, so an agent can ask
      // for the rest by name.
      expect(projection.targets[0]!.id).toBe("target-0");
    });

    /** @scenario "The state an assistant reads never exceeds the budget" */
    it("counts non-ASCII text by its UTF-8 size", () => {
      const state = baseState();
      // Three UTF-8 bytes per character, one UTF-16 code unit: 60 names of 240
      // characters fit the budget counted by `String.length` and overrun it
      // counted in the bytes a transport carries.
      state.datasets = Array.from({ length: 60 }, (_, index) => {
        const copy = dataset();
        copy.id = `ds-${index}`;
        copy.name = "評価データ".repeat(48);
        copy.inline!.records = { input: [], expected_output: [] };
        return copy;
      });

      const names = state.datasets.map((d) => d.name).join("");
      expect(names.length).toBeLessThan(PROJECTION_BUDGET_BYTES);
      expect(utf8Bytes(names)).toBeGreaterThan(PROJECTION_BUDGET_BYTES);

      const projection = projectWorkbenchState({ state });

      expect(projection.truncated).toBe(true);
      expect(projection.omittedDatasets).toBeGreaterThan(0);
      expect(serializedBytes(projection)).toBeLessThanOrEqual(
        PROJECTION_BUDGET_BYTES,
      );
    });
  });

  describe("given a sample cell longer than the cap", () => {
    it("truncates the cell", () => {
      const state = baseState();
      state.datasets[0]!.inline!.records.input = ["x".repeat(500)];

      const projection = projectWorkbenchState({ state });

      const cell = projection.datasets[0]!.sampleRows![0]!.input!;
      expect(cell).toHaveLength(201);
      expect(cell.endsWith("…")).toBe(true);
    });
  });
});
