import { beforeEach, describe, expect, it } from "vitest";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import { createInitialResults, createInitialState } from "../../types";
import {
  extractPersistedState,
  persistedEvaluationsV3StateSchema,
} from "../persistence";

describe("Persistence", () => {
  beforeEach(() => {
    useEvaluationsV3Store.setState(createInitialState());
    // Clear temporal history
    useEvaluationsV3Store.temporal.getState().clear();
  });

  describe("extractPersistedState from actual store state", () => {
    it("persists hiddenColumns from actual store UI state", () => {
      // This test ensures that when extractPersistedState is called with the
      // actual store state (as done in useAutosaveEvaluationsV3), hiddenColumns
      // are correctly extracted from ui.hiddenColumns
      const store = useEvaluationsV3Store.getState();

      // Hide some columns via the store action
      store.toggleColumnVisibility("input");
      store.toggleColumnVisibility("expected_output");

      // Get the full store state (simulating what useAutosaveEvaluationsV3 does)
      const fullState = useEvaluationsV3Store.getState();

      // Extract persisted state from the FULL store state
      const persisted = extractPersistedState(fullState);

      // hiddenColumns should be extracted from ui.hiddenColumns
      expect(persisted.hiddenColumns).toContain("input");
      expect(persisted.hiddenColumns).toContain("expected_output");
      expect(persisted.hiddenColumns?.length).toBe(2);
    });

    it("persists empty hiddenColumns when none are hidden in store", () => {
      // Get the full store state with no hidden columns
      const fullState = useEvaluationsV3Store.getState();

      // Verify no columns are hidden initially
      expect(fullState.ui.hiddenColumns.size).toBe(0);

      const persisted = extractPersistedState(fullState);

      expect(persisted.hiddenColumns).toEqual([]);
    });

    it("round-trips hiddenColumns through extract and load", () => {
      // Hide columns
      useEvaluationsV3Store.getState().toggleColumnVisibility("input");
      useEvaluationsV3Store.getState().toggleColumnVisibility("some_column");

      // Extract persisted state
      const persisted = extractPersistedState(useEvaluationsV3Store.getState());

      // Reset store to initial state
      useEvaluationsV3Store.setState(createInitialState());
      expect(useEvaluationsV3Store.getState().ui.hiddenColumns.size).toBe(0);

      // Load the persisted state back
      useEvaluationsV3Store.getState().loadState(persisted);

      // Verify hidden columns are restored
      const restoredState = useEvaluationsV3Store.getState();
      expect(restoredState.ui.hiddenColumns.has("input")).toBe(true);
      expect(restoredState.ui.hiddenColumns.has("some_column")).toBe(true);
      expect(restoredState.ui.hiddenColumns.size).toBe(2);
    });
  });

  describe("extractPersistedState", () => {
    it("excludes transient UI state from persisted state", () => {
      const state = createInitialState();
      state.ui.selectedRows = new Set([0, 1, 2]);
      state.ui.rowHeightMode = "expanded";

      const persisted = extractPersistedState(state);

      // Transient UI state should not be persisted
      expect(persisted).not.toHaveProperty("ui");
      expect(persisted).not.toHaveProperty("selectedRows");
      expect(persisted).not.toHaveProperty("rowHeightMode");
    });

    it("persists hiddenColumns as array for JSON serialization", () => {
      const state = createInitialState();
      state.ui.hiddenColumns = new Set(["input", "expected_output"]);

      const persisted = extractPersistedState(state);

      // hiddenColumns should be persisted (converted to array for JSON)
      expect(persisted.hiddenColumns).toEqual(["input", "expected_output"]);
    });

    it("persists empty hiddenColumns as empty array", () => {
      const state = createInitialState();
      state.ui.hiddenColumns = new Set();

      const persisted = extractPersistedState(state);

      expect(persisted.hiddenColumns).toEqual([]);
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
        "target-1": [
          "Error on row 0",
          undefined as unknown as string,
          "Error on row 2",
        ],
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

    it("strips savedRecords from saved datasets", () => {
      const state = createInitialState();
      state.datasets = [
        {
          id: "saved-dataset-1",
          name: "My Saved Dataset",
          type: "saved",
          datasetId: "db-dataset-id",
          columns: [{ id: "col1", name: "input", type: "string" }],
          savedRecords: [
            { id: "rec1", input: "row 1 data" },
            { id: "rec2", input: "row 2 data" },
            { id: "rec3", input: "row 3 data" },
          ],
        },
      ];

      const persisted = extractPersistedState(state);

      // savedRecords should be stripped - they're loaded from DB on demand
      expect(persisted.datasets[0]).not.toHaveProperty("savedRecords");
      // But other properties should be preserved
      expect(persisted.datasets[0]).toEqual({
        id: "saved-dataset-1",
        name: "My Saved Dataset",
        type: "saved",
        datasetId: "db-dataset-id",
        columns: [{ id: "col1", name: "input", type: "string" }],
      });
    });

    it("preserves inline dataset records (they are part of the experiment)", () => {
      const state = createInitialState();
      state.datasets = [
        {
          id: "inline-dataset-1",
          name: "Test Data",
          type: "inline",
          columns: [{ id: "col1", name: "input", type: "string" }],
          inline: {
            columns: [{ id: "col1", name: "input", type: "string" }],
            records: { col1: ["value 1", "value 2"] },
          },
        },
      ];

      const persisted = extractPersistedState(state);

      // Inline dataset records SHOULD be preserved
      expect(persisted.datasets[0]).toHaveProperty("inline");
      expect((persisted.datasets[0] as any).inline.records).toEqual({
        col1: ["value 1", "value 2"],
      });
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
    it("loads hiddenColumns from persisted state into UI", () => {
      const persistedState = {
        name: "Test Evaluation",
        datasets: [],
        activeDatasetId: "test-dataset",
        evaluators: [],
        targets: [],
        hiddenColumns: ["input", "expected_output"],
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.hiddenColumns).toBeInstanceOf(Set);
      expect(state.ui.hiddenColumns.has("input")).toBe(true);
      expect(state.ui.hiddenColumns.has("expected_output")).toBe(true);
      expect(state.ui.hiddenColumns.size).toBe(2);
    });

    it("handles missing hiddenColumns in persisted state", () => {
      const persistedState = {
        name: "Test Evaluation",
        datasets: [],
        activeDatasetId: "test-dataset",
        evaluators: [],
        targets: [],
        // No hiddenColumns field
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.hiddenColumns).toBeInstanceOf(Set);
      expect(state.ui.hiddenColumns.size).toBe(0);
    });

    it("loads concurrency from persisted state into UI", () => {
      const persistedState = {
        name: "Test Evaluation",
        datasets: [],
        activeDatasetId: "test-dataset",
        evaluators: [],
        targets: [],
        concurrency: 20,
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.concurrency).toBe(20);
    });

    it("handles missing concurrency in persisted state (uses default)", () => {
      // Set a non-default value first
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        ui: { ...state.ui, concurrency: 5 },
      }));

      const persistedState = {
        name: "Test Evaluation",
        datasets: [],
        activeDatasetId: "test-dataset",
        evaluators: [],
        targets: [],
        // No concurrency field
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      const state = useEvaluationsV3Store.getState();
      // Should keep the existing value when not in persisted state
      expect(state.ui.concurrency).toBe(5);
    });

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

    it("clears undo/redo history after loading state", () => {
      // Make some changes to create undo history
      useEvaluationsV3Store.getState().setName("First Change");
      useEvaluationsV3Store.getState().setName("Second Change");

      // Wait for debounced temporal to catch up (simulate some time passing)
      // Note: In real usage, the debounce would create history entries
      // For this test, we manually verify the clear() is called

      // Verify we have some state
      expect(useEvaluationsV3Store.getState().name).toBe("Second Change");

      // Load persisted state
      const persistedState = {
        name: "Loaded Evaluation",
        datasets: [],
        activeDatasetId: "test-dataset",
        evaluators: [],
        targets: [],
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      // Verify state was loaded
      expect(useEvaluationsV3Store.getState().name).toBe("Loaded Evaluation");

      // Verify undo history is cleared (no past states)
      const temporal = useEvaluationsV3Store.temporal.getState();
      expect(temporal.pastStates.length).toBe(0);
      expect(temporal.futureStates.length).toBe(0);
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
      expect(state.results.targetOutputs["target-1"]).toEqual([
        "existing output",
      ]);
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
          targetOutputs: { t1: ["out"] },
          targetMetadata: { t1: [{ cost: 0.01 }] },
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
          targetOutputs: { t1: [null, "output", null] },
          targetMetadata: { t1: [null, { cost: 0.01 }, null] },
          evaluatorResults: { t1: { e1: [null, { passed: true }] } },
          errors: { t1: [null, null, "error"] },
        },
      };

      const result = persistedEvaluationsV3StateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });
  });
});
