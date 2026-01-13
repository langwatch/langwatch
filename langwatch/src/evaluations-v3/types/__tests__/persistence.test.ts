import { describe, it, expect, beforeEach } from "vitest";
import { extractPersistedState, persistedEvaluationsV3StateSchema } from "../persistence";
import { createInitialState, createInitialResults } from "../../types";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";

describe("Persistence", () => {
  beforeEach(() => {
    useEvaluationsV3Store.setState(createInitialState());
  });

  describe("extractPersistedState", () => {
    it("excludes UI state from persisted state", () => {
      const state = createInitialState();
      state.ui.selectedRows = new Set([0, 1, 2]);
      state.ui.rowHeightMode = "expanded";

      const persisted = extractPersistedState(state);

      expect(persisted).not.toHaveProperty("ui");
    });

    it("excludes transient result fields (status, progress, executingCells)", () => {
      const state = createInitialState();
      state.results = {
        ...createInitialResults(),
        status: "running",
        progress: 5,
        total: 10,
        executingCells: new Set(["0:target-1", "1:target-1"]),
        targetOutputs: { "target-1": ["output 1", "output 2"] },
        evaluatorResults: {},
        errors: {},
      };

      const persisted = extractPersistedState(state);

      // Results should be included but without transient fields
      expect(persisted.results).toBeDefined();
      expect(persisted.results).not.toHaveProperty("status");
      expect(persisted.results).not.toHaveProperty("progress");
      expect(persisted.results).not.toHaveProperty("total");
      expect(persisted.results).not.toHaveProperty("executingCells");
    });

    it("includes targetOutputs in persisted results", () => {
      const state = createInitialState();
      state.results.targetOutputs = {
        "target-1": ["output row 0", "output row 1"],
        "target-2": ["other output"],
      };

      const persisted = extractPersistedState(state);

      expect(persisted.results?.targetOutputs).toEqual({
        "target-1": ["output row 0", "output row 1"],
        "target-2": ["other output"],
      });
    });

    it("includes targetMetadata in persisted results", () => {
      const state = createInitialState();
      state.results.targetMetadata = {
        "target-1": [
          { cost: 0.001, duration: 500, traceId: "trace-1" },
          { cost: 0.002, duration: 750 },
        ],
      };

      const persisted = extractPersistedState(state);

      expect(persisted.results?.targetMetadata).toEqual({
        "target-1": [
          { cost: 0.001, duration: 500, traceId: "trace-1" },
          { cost: 0.002, duration: 750 },
        ],
      });
    });

    it("includes evaluatorResults in persisted results", () => {
      const state = createInitialState();
      state.results.evaluatorResults = {
        "target-1": {
          "eval-1": [{ passed: true, score: 0.8 }, { passed: false }],
        },
      };

      const persisted = extractPersistedState(state);

      expect(persisted.results?.evaluatorResults).toEqual({
        "target-1": {
          "eval-1": [{ passed: true, score: 0.8 }, { passed: false }],
        },
      });
    });

    it("includes errors in persisted results", () => {
      const state = createInitialState();
      state.results.errors = {
        "target-1": ["Error on row 0", undefined as unknown as string, "Error on row 2"],
      };

      const persisted = extractPersistedState(state);

      expect(persisted.results?.errors).toEqual({
        "target-1": ["Error on row 0", undefined, "Error on row 2"],
      });
    });

    it("returns undefined results when no actual results exist", () => {
      const state = createInitialState();
      // Initial state has empty results
      
      const persisted = extractPersistedState(state);

      expect(persisted.results).toBeUndefined();
    });

    it("includes runId and versionId in persisted results", () => {
      const state = createInitialState();
      state.results = {
        ...createInitialResults(),
        runId: "run-123",
        versionId: "version-456",
        targetOutputs: { "target-1": ["some output"] },
      };

      const persisted = extractPersistedState(state);

      expect(persisted.results?.runId).toBe("run-123");
      expect(persisted.results?.versionId).toBe("version-456");
    });

    it("handles sparse arrays with null/undefined values", () => {
      const state = createInitialState();
      // Simulate running only row 1, leaving row 0 empty
      state.results = {
        ...createInitialResults(),
        targetOutputs: {
          "target-1": [undefined, "output row 1", undefined],
        },
        targetMetadata: {
          "target-1": [null, { cost: 0.01, duration: 500 }, null],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [undefined, { passed: true }, undefined],
          },
        },
        errors: {
          "target-1": [undefined, undefined, "error on row 2"],
        },
      };

      const persisted = extractPersistedState(state);

      expect(persisted.results).toBeDefined();
      // Sparse arrays should be preserved
      expect(persisted.results?.targetOutputs["target-1"]).toEqual([
        undefined,
        "output row 1",
        undefined,
      ]);
      expect(persisted.results?.targetMetadata["target-1"]).toEqual([
        null,
        { cost: 0.01, duration: 500 },
        null,
      ]);
      expect(persisted.results?.errors["target-1"]).toEqual([
        undefined,
        undefined,
        "error on row 2",
      ]);
    });
  });

  describe("loadState", () => {
    it("loads persisted results into the store", () => {
      const persistedState = {
        name: "Test Evaluation",
        datasets: [],
        activeDatasetId: "test-dataset",
        evaluators: [],
        targets: [],
        results: {
          runId: "run-abc",
          targetOutputs: {
            "target-1": ["loaded output 1", "loaded output 2"],
          },
          targetMetadata: {
            "target-1": [{ cost: 0.005, duration: 1000 }],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [{ passed: true }],
            },
          },
          errors: {},
        },
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      const state = useEvaluationsV3Store.getState();
      expect(state.results.runId).toBe("run-abc");
      expect(state.results.targetOutputs["target-1"]).toEqual([
        "loaded output 1",
        "loaded output 2",
      ]);
      expect(state.results.targetMetadata["target-1"]).toEqual([
        { cost: 0.005, duration: 1000 },
      ]);
      expect(state.results.evaluatorResults["target-1"]?.["eval-1"]).toEqual([
        { passed: true },
      ]);
    });

    it("preserves current results if persisted state has no results", () => {
      // Set up some existing results
      useEvaluationsV3Store.getState().setResults({
        targetOutputs: { "target-1": ["existing output"] },
      });

      const persistedState = {
        name: "Test Evaluation",
        datasets: [],
        activeDatasetId: "test-dataset",
        evaluators: [],
        targets: [],
        // No results field
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      const state = useEvaluationsV3Store.getState();
      // Existing results should be preserved
      expect(state.results.targetOutputs["target-1"]).toEqual(["existing output"]);
    });

    it("loads results with status set to idle (not running)", () => {
      const persistedState = {
        name: "Test Evaluation",
        datasets: [],
        activeDatasetId: "test-dataset",
        evaluators: [],
        targets: [],
        results: {
          targetOutputs: { "target-1": ["output"] },
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      const state = useEvaluationsV3Store.getState();
      // Status should be idle, not running
      expect(state.results.status).toBe("idle");
      // No executing cells
      expect(state.results.executingCells).toBeUndefined();
    });
  });

  describe("persistedEvaluationsV3StateSchema", () => {
    it("validates state with results", () => {
      const state = {
        experimentId: "exp-123",
        name: "Test",
        datasets: [],
        activeDatasetId: "ds-1",
        evaluators: [],
        targets: [],
        results: {
          runId: "run-1",
          targetOutputs: { "t1": ["out"] },
          targetMetadata: { "t1": [{ cost: 0.01 }] },
          evaluatorResults: {},
          errors: {},
        },
      };

      const result = persistedEvaluationsV3StateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    it("validates state without results", () => {
      const state = {
        name: "Test",
        datasets: [],
        activeDatasetId: "ds-1",
        evaluators: [],
        targets: [],
      };

      const result = persistedEvaluationsV3StateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });

    it("validates state with sparse arrays containing null values", () => {
      const state = {
        name: "Test",
        datasets: [],
        activeDatasetId: "ds-1",
        evaluators: [],
        targets: [],
        results: {
          targetOutputs: { "t1": [null, "output", null] },
          targetMetadata: { "t1": [null, { cost: 0.01 }, null] },
          evaluatorResults: { "t1": { "e1": [null, { passed: true }] } },
          errors: { "t1": [null, null, "error"] },
        },
      };

      const result = persistedEvaluationsV3StateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });
  });
});
