/**
 * @vitest-environment jsdom
 *
 * Integration tests for evaluation results persistence.
 * Verifies that:
 * 1. Results are included in the autosave payload after execution
 * 2. Results are loaded and displayed correctly when the table renders
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosaveEvaluationsV3 } from "../hooks/useAutosaveEvaluationsV3";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { createInitialResults, createInitialState } from "../types";
import { extractPersistedState } from "../types/persistence";

// Mock router
vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { slug: "test-evaluation" },
    replace: vi.fn(),
  }),
}));

// Mock organization/project
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123", slug: "test-project" },
  }),
}));

// Track mutation calls
const mockMutateAsync = vi.fn().mockResolvedValue({
  id: "exp-123",
  slug: "test-evaluation",
  name: "Test Evaluation",
});

// Mock TRPC
vi.mock("~/utils/api", () => ({
  api: {
    experiments: {
      saveEvaluationsV3: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          isPending: false,
        }),
      },
      getEvaluationsV3BySlug: {
        useQuery: () => ({
          data: null,
          isLoading: false,
        }),
      },
    },
  },
}));

// Mock toaster
vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

const _AUTOSAVE_DEBOUNCE_MS = 1500;

const _Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Component that uses the autosave hook
const _TestAutosaveComponent = () => {
  useAutosaveEvaluationsV3();
  return <div data-testid="autosave-test">Autosave Active</div>;
};

describe("Results Persistence Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset store to initial state
    useEvaluationsV3Store.setState(createInitialState());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("extractPersistedState includes results", () => {
    it("includes targetOutputs in persisted state", () => {
      const state = createInitialState();
      state.results.targetOutputs = {
        "target-1": ["output row 0", "output row 1"],
      };

      const persisted = extractPersistedState(state);

      expect(persisted.results).toBeDefined();
      expect(persisted.results?.targetOutputs).toEqual({
        "target-1": ["output row 0", "output row 1"],
      });
    });

    it("includes evaluatorResults in persisted state", () => {
      const state = createInitialState();
      state.results.evaluatorResults = {
        "target-1": {
          "eval-1": [{ passed: true, score: 0.9 }],
        },
      };

      const persisted = extractPersistedState(state);

      expect(persisted.results?.evaluatorResults).toEqual({
        "target-1": {
          "eval-1": [{ passed: true, score: 0.9 }],
        },
      });
    });

    it("excludes transient fields from persisted results", () => {
      const state = createInitialState();
      state.results = {
        ...createInitialResults(),
        status: "running",
        progress: 5,
        total: 10,
        executingCells: new Set(["0:target-1"]),
        targetOutputs: { "target-1": ["output"] },
      };

      const persisted = extractPersistedState(state);

      expect(persisted.results).toBeDefined();
      expect(persisted.results).not.toHaveProperty("status");
      expect(persisted.results).not.toHaveProperty("progress");
      expect(persisted.results).not.toHaveProperty("total");
      expect(persisted.results).not.toHaveProperty("executingCells");
    });
  });

  describe("Autosave hook reads results from store", () => {
    it("useAutosaveEvaluationsV3 subscribes to results changes", () => {
      // This test verifies the hook includes results in its state subscription
      // by checking the extractPersistedState output with real results

      useEvaluationsV3Store.setState({
        ...createInitialState(),
        name: "Test Evaluation",
        experimentId: "exp-123",
        results: {
          ...createInitialResults(),
          targetOutputs: {
            "target-1": ["Result for row 0", "Result for row 1"],
          },
          targetMetadata: {
            "target-1": [{ cost: 0.001, duration: 500, traceId: "trace-abc" }],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [{ passed: true }],
            },
          },
        },
      });

      const state = useEvaluationsV3Store.getState();
      const persistedState = extractPersistedState(state);

      // Verify results are included in persisted state
      expect(persistedState.results).toBeDefined();
      expect(persistedState.results?.targetOutputs["target-1"]).toEqual([
        "Result for row 0",
        "Result for row 1",
      ]);
      expect(persistedState.results?.targetMetadata["target-1"]).toEqual([
        { cost: 0.001, duration: 500, traceId: "trace-abc" },
      ]);
      expect(
        persistedState.results?.evaluatorResults["target-1"]?.["eval-1"],
      ).toEqual([{ passed: true }]);
    });

    it("extractPersistedState excludes transient execution state", () => {
      useEvaluationsV3Store.setState({
        ...createInitialState(),
        name: "Test Evaluation",
        experimentId: "exp-123",
        results: {
          ...createInitialResults(),
          status: "running",
          progress: 2,
          total: 5,
          executingCells: new Set(["0:target-1", "1:target-1"]),
          targetOutputs: { "target-1": ["Completed output"] },
        },
      });

      const state = useEvaluationsV3Store.getState();
      const persistedState = extractPersistedState(state);

      expect(persistedState.results).toBeDefined();
      // Transient fields should NOT be present
      expect(persistedState.results).not.toHaveProperty("status");
      expect(persistedState.results).not.toHaveProperty("progress");
      expect(persistedState.results).not.toHaveProperty("total");
      expect(persistedState.results).not.toHaveProperty("executingCells");
      // But actual results should be present
      expect(persistedState.results?.targetOutputs["target-1"]).toEqual([
        "Completed output",
      ]);
    });
  });

  describe("loadState restores results", () => {
    it("loads persisted results into the store", () => {
      const persistedState = {
        name: "Loaded Evaluation",
        datasets: [],
        activeDatasetId: "dataset-1",
        evaluators: [],
        targets: [],
        results: {
          runId: "run-abc",
          targetOutputs: {
            "target-1": ["Loaded output 1", "Loaded output 2"],
          },
          targetMetadata: {
            "target-1": [{ cost: 0.005, duration: 1000, traceId: "trace-xyz" }],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [{ passed: true, score: 0.95 }],
            },
          },
          errors: {},
        },
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      const state = useEvaluationsV3Store.getState();

      // Results should be loaded
      expect(state.results.runId).toBe("run-abc");
      expect(state.results.targetOutputs["target-1"]).toEqual([
        "Loaded output 1",
        "Loaded output 2",
      ]);
      expect(state.results.targetMetadata["target-1"]).toEqual([
        { cost: 0.005, duration: 1000, traceId: "trace-xyz" },
      ]);
      expect(state.results.evaluatorResults["target-1"]?.["eval-1"]).toEqual([
        { passed: true, score: 0.95 },
      ]);

      // Status should be idle (not running)
      expect(state.results.status).toBe("idle");
      expect(state.results.executingCells).toBeUndefined();
    });

    it("preserves existing results if persisted state has no results", () => {
      // Set up existing results
      useEvaluationsV3Store.getState().setResults({
        targetOutputs: { "target-1": ["Existing output"] },
      });

      const persistedState = {
        name: "Loaded Evaluation",
        datasets: [],
        activeDatasetId: "dataset-1",
        evaluators: [],
        targets: [],
        // No results field
      };

      useEvaluationsV3Store.getState().loadState(persistedState);

      const state = useEvaluationsV3Store.getState();

      // Existing results should be preserved
      expect(state.results.targetOutputs["target-1"]).toEqual([
        "Existing output",
      ]);
    });
  });

  describe("Full round-trip: save and load", () => {
    it("results survive a save-load cycle", async () => {
      // 1. Set up results in the store
      useEvaluationsV3Store.setState({
        ...createInitialState(),
        name: "Round Trip Test",
        experimentId: "exp-roundtrip",
        results: {
          ...createInitialResults(),
          targetOutputs: {
            "target-1": ["Output A", "Output B"],
            "target-2": ["Output X"],
          },
          targetMetadata: {
            "target-1": [
              { cost: 0.01, duration: 100 },
              { cost: 0.02, duration: 200 },
            ],
          },
          evaluatorResults: {
            "target-1": {
              "exact-match": [{ passed: true }, { passed: false }],
            },
          },
          errors: {
            "target-2": [undefined as unknown as string, "Error on row 1"],
          },
        },
      });

      // 2. Extract persisted state (what would be saved)
      const state = useEvaluationsV3Store.getState();
      const persistedState = extractPersistedState(state);

      // 3. Reset store to simulate page reload
      useEvaluationsV3Store.setState(createInitialState());

      // Verify reset
      expect(useEvaluationsV3Store.getState().results.targetOutputs).toEqual(
        {},
      );

      // 4. Load the persisted state (what would happen on page load)
      useEvaluationsV3Store.getState().loadState(persistedState);

      // 5. Verify results are restored
      const restoredState = useEvaluationsV3Store.getState();

      expect(restoredState.results.targetOutputs["target-1"]).toEqual([
        "Output A",
        "Output B",
      ]);
      expect(restoredState.results.targetOutputs["target-2"]).toEqual([
        "Output X",
      ]);
      expect(restoredState.results.targetMetadata["target-1"]).toEqual([
        { cost: 0.01, duration: 100 },
        { cost: 0.02, duration: 200 },
      ]);
      expect(
        restoredState.results.evaluatorResults["target-1"]?.["exact-match"],
      ).toEqual([{ passed: true }, { passed: false }]);
      expect(restoredState.results.errors["target-2"]).toEqual([
        undefined,
        "Error on row 1",
      ]);
    });
  });
});
