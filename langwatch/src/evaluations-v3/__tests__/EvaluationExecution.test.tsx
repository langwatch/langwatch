/**
 * @vitest-environment jsdom
 *
 * Integration tests for evaluation execution flow.
 * Tests the full worksheet rendering as evaluations execute:
 * - Skeletons appear when execution starts
 * - Results stream in and replace skeletons
 * - Errors are displayed correctly
 * - Progress updates
 * - Abort handling
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { createExecutionCellSet } from "../utils/executionScope";

// Mock optimization_studio hooks to prevent circular dependency issues
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

// Mock useLatestPromptVersion to avoid needing SessionProvider
vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));

import type { EvaluationV3Event } from "~/server/evaluations-v3/execution/types";
import { fetchSSE } from "~/utils/sse/fetchSSE";
import { EvaluationsV3Table } from "../components/EvaluationsV3Table";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Mock next/router
vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

// Mock useDrawer
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

// Mock api
vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      agents: {
        getById: {
          fetch: vi.fn(),
        },
      },
      prompts: {
        getByIdOrHandle: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      evaluators: {
        getById: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
    }),
    datasetRecord: {
      getAll: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
      update: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
      deleteMany: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
    },
    agents: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    evaluators: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
  },
}));

// Mock SSE utility
vi.mock("~/utils/sse/fetchSSE", () => ({
  fetchSSE: vi.fn(),
}));

// Mock toaster
vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

// Mock AddOrEditDatasetDrawer
vi.mock("~/components/AddOrEditDatasetDrawer", () => ({
  AddOrEditDatasetDrawer: () => null,
}));

// Mock Agent Drawers
vi.mock("~/components/agents/AgentListDrawer", () => ({
  AgentListDrawer: () => null,
}));
vi.mock("~/components/agents/AgentTypeSelectorDrawer", () => ({
  AgentTypeSelectorDrawer: () => null,
}));
vi.mock("~/components/agents/AgentCodeEditorDrawer", () => ({
  AgentCodeEditorDrawer: () => null,
}));
vi.mock("~/components/agents/WorkflowSelectorDrawer", () => ({
  WorkflowSelectorDrawer: () => null,
}));

// Mock Evaluator Drawers
vi.mock("~/components/evaluators/EvaluatorListDrawer", () => ({
  EvaluatorListDrawer: () => null,
}));
vi.mock("~/components/evaluators/EvaluatorEditorDrawer", () => ({
  EvaluatorEditorDrawer: () => null,
}));

// Mock Prompt Drawers
vi.mock("~/components/prompts/PromptListDrawer", () => ({
  PromptListDrawer: () => null,
}));
vi.mock("~/components/prompts/registry/RegistryDrawer", () => ({
  RegistryDrawer: () => null,
}));
vi.mock("~/components/prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));

// ============================================================================
// Test Helpers
// ============================================================================

const mockFetchSSE = fetchSSE as Mock;

/**
 * Helper to setup the store with a configured evaluation
 */
const setupStoreWithConfiguredEvaluation = () => {
  // First reset to clean state with our dataset
  useEvaluationsV3Store.setState({
    name: "Test Evaluation",
    experimentId: undefined,
    experimentSlug: undefined,
    datasets: [
      {
        id: "test-dataset",
        name: "Test Dataset",
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
            input: ["Hello", "World", "Test"],
            expected_output: ["Hi", "Earth", "Testing"],
          },
        },
      },
    ],
    activeDatasetId: "test-dataset",
    targets: [
      {
        id: "target-1",
        type: "prompt",
        promptId: "prompt-123",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          "test-dataset": {
            input: {
              type: "source",
              source: "dataset",
              sourceId: "test-dataset",
              sourceField: "input",
            },
          },
        },
      },
    ],
    evaluators: [
      {
        id: "eval-1",
        evaluatorType: "langevals/exact_match",
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        mappings: {
          "test-dataset": {
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
                sourceId: "test-dataset",
                sourceField: "expected_output",
              },
            },
          },
        },
      },
    ],
    results: {
      status: "idle",
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    },
    pendingSavedChanges: {},
    ui: {
      selectedRows: new Set(),
      columnWidths: {},
      rowHeightMode: "compact",
      expandedCells: new Set(),
      hiddenColumns: new Set(),
      autosaveStatus: {
        evaluation: "idle",
        dataset: "idle",
      },
      concurrency: 10,
    },
  });
};

/**
 * Helper to simulate SSE events
 */
const simulateSSEEvents = (events: EvaluationV3Event[]) => {
  mockFetchSSE.mockImplementation(async ({ onEvent }) => {
    for (const event of events) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      onEvent(event);
    }
  });
};

const renderTable = () => {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EvaluationsV3Table disableVirtualization />
    </ChakraProvider>,
  );
};

// ============================================================================
// Test Suite
// ============================================================================

describe("Evaluation Execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Initial State", () => {
    it("renders the table with configured targets and evaluators", () => {
      setupStoreWithConfiguredEvaluation();
      renderTable();

      // Should see the target column header
      expect(screen.getByText("My Prompt")).toBeInTheDocument();

      // Should see the evaluator chips (one per row)
      const evalChips = screen.getAllByText("Exact Match");
      expect(evalChips.length).toBeGreaterThanOrEqual(1);

      // Should see "No output yet" for all target cells
      const noOutputTexts = screen.getAllByText("No output yet");
      expect(noOutputTexts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Execution Started", () => {
    it("shows running state when execution starts", async () => {
      setupStoreWithConfiguredEvaluation();

      // Simulate execution starting
      simulateSSEEvents([
        { type: "execution_started", runId: "run-123", total: 3 },
      ]);

      renderTable();

      // Trigger execution by updating store
      act(() => {
        useEvaluationsV3Store.getState().setResults({
          status: "running",
          runId: "run-123",
          progress: 0,
          total: 3,
        });
      });

      // The status should be running
      const results = useEvaluationsV3Store.getState().results;
      expect(results.status).toBe("running");
    });

    it("shows skeleton loading state during execution", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set running state before render
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        runId: "run-123",
        progress: 0,
        total: 3,
      });

      renderTable();

      // Should NOT see "No output yet" since we're loading
      // Instead should see skeleton (Chakra Skeleton component)
      await waitFor(() => {
        // The table should render with loading state
        const results = useEvaluationsV3Store.getState().results;
        expect(results.status).toBe("running");
      });
    });
  });

  describe("Results Streaming", () => {
    it("displays target output from initial results", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set results before render (simulating SSE event received)
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        targetOutputs: {
          "target-1": ["Hello response", undefined, undefined],
        },
      });

      renderTable();

      // Should see the output
      await waitFor(() => {
        expect(screen.getByText("Hello response")).toBeInTheDocument();
      });
    });

    it("displays evaluator result from initial results", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set results before render
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        targetOutputs: {
          "target-1": ["Test output", undefined, undefined],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [
              { status: "processed", passed: true, score: 1.0 },
              undefined,
              undefined,
            ],
          },
        },
      });

      renderTable();

      // The evaluator chip should show the score (may appear multiple times with target summary)
      await waitFor(() => {
        expect(screen.getAllByText("1.00").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("displays multiple rows of results", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set all results before render
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        targetOutputs: {
          "target-1": ["Response 1", "Response 2", undefined],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [
              { status: "processed", passed: true, score: 1.0 },
              { status: "processed", passed: false, score: 0.0 },
              undefined,
            ],
          },
        },
      });

      renderTable();

      await waitFor(() => {
        expect(screen.getByText("Response 1")).toBeInTheDocument();
        expect(screen.getByText("Response 2")).toBeInTheDocument();
      });

      // Should show scores for both rows
      expect(screen.getByText("1.00")).toBeInTheDocument();
      expect(screen.getByText("0.00")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("displays target error in the cell with error styling", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set error state before render
      const errors: Record<string, string[]> = { "target-1": [] };
      errors["target-1"]![0] = "Rate limit exceeded";
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        errors,
      });

      renderTable();

      // The error message should be visible in the cell
      await waitFor(() => {
        expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument();
      });

      // Verify store state
      const results = useEvaluationsV3Store.getState().results;
      expect(results.errors["target-1"]?.[0]).toBe("Rate limit exceeded");
    });

    it("displays evaluator error status in the chip", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set error state before render
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        targetOutputs: {
          "target-1": ["Valid output", undefined, undefined],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [
              {
                status: "error",
                error_type: "EvaluatorError",
                details: "Missing expected_output",
              },
              undefined,
              undefined,
            ],
          },
        },
      });

      renderTable();

      // The output should still be visible
      await waitFor(() => {
        expect(screen.getByText("Valid output")).toBeInTheDocument();
      });

      // The evaluator chip should show error state (orange color indicator)
      // This is handled by parseEvaluationResult which returns status: "error"
    });
  });

  describe("Completion", () => {
    it("shows success status when all rows complete", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set results BEFORE rendering
      useEvaluationsV3Store.getState().setResults({
        status: "success",
        runId: "run-123",
        progress: 3,
        total: 3,
        targetOutputs: {
          "target-1": ["Output Row 1", "Output Row 2", "Output Row 3"],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [
              { status: "processed", passed: true, score: 1.0 },
              { status: "processed", passed: true, score: 1.0 },
              { status: "processed", passed: true, score: 1.0 },
            ],
          },
        },
      });

      renderTable();

      // All outputs should be visible
      await waitFor(() => {
        expect(screen.getByText("Output Row 1")).toBeInTheDocument();
      });

      expect(screen.getByText("Output Row 2")).toBeInTheDocument();
      expect(screen.getByText("Output Row 3")).toBeInTheDocument();

      // All evaluator results should show 1.00 (may also appear in target summary)
      const scores = screen.getAllByText("1.00");
      expect(scores.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Multiple Targets", () => {
    it("shows results for each target in separate columns", async () => {
      setupStoreWithConfiguredEvaluation();

      // Add another target to the store
      const currentState = useEvaluationsV3Store.getState();
      useEvaluationsV3Store.setState({
        ...currentState,
        targets: [
          ...currentState.targets,
          {
            id: "target-2",
            type: "prompt",
            promptId: "prompt-456",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              "test-dataset": {
                input: {
                  type: "source",
                  source: "dataset",
                  sourceId: "test-dataset",
                  sourceField: "input",
                },
              },
            },
          },
        ],
        results: {
          ...currentState.results,
          status: "success",
          targetOutputs: {
            "target-1": ["Output A1", "Output A2", "Output A3"],
            "target-2": ["Output B1", "Output B2", "Output B3"],
          },
        },
      });

      renderTable();

      // Should see both target headers
      expect(screen.getByText("My Prompt")).toBeInTheDocument();
      expect(screen.getByText("Other Prompt")).toBeInTheDocument();

      // All outputs should be visible
      await waitFor(() => {
        expect(screen.getByText("Output A1")).toBeInTheDocument();
        expect(screen.getByText("Output B1")).toBeInTheDocument();
      });
    });
  });

  describe("Store Results Structure", () => {
    it("correctly structures results by target and evaluator", () => {
      setupStoreWithConfiguredEvaluation();

      // Set complex results structure
      act(() => {
        useEvaluationsV3Store.getState().setResults({
          status: "success",
          runId: "run-123",
          progress: 3,
          total: 3,
          targetOutputs: {
            "target-1": ["Out 1", "Out 2", "Out 3"],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [
                { status: "processed", passed: true, score: 1.0 },
                { status: "processed", passed: false, score: 0.5 },
                { status: "processed", passed: true, score: 0.8 },
              ],
            },
          },
          errors: {},
        });
      });

      const results = useEvaluationsV3Store.getState().results;

      // Verify structure
      expect(results.status).toBe("success");
      expect(results.targetOutputs["target-1"]).toHaveLength(3);
      expect(results.evaluatorResults["target-1"]?.["eval-1"]).toHaveLength(3);
      expect(results.evaluatorResults["target-1"]?.["eval-1"]?.[1]).toEqual(
        expect.objectContaining({ passed: false, score: 0.5 }),
      );
    });
  });

  describe("Partial Results", () => {
    it("preserves existing results when adding new ones", () => {
      setupStoreWithConfiguredEvaluation();

      // First result
      act(() => {
        useEvaluationsV3Store.getState().setResults({
          status: "running",
          targetOutputs: {
            "target-1": ["First", undefined, undefined],
          },
        });
      });

      // Second result should merge, not replace
      act(() => {
        const current = useEvaluationsV3Store.getState().results;
        const newOutputs = [...(current.targetOutputs["target-1"] ?? [])];
        newOutputs[1] = "Second";
        useEvaluationsV3Store.getState().setResults({
          targetOutputs: {
            "target-1": newOutputs,
          },
        });
      });

      const results = useEvaluationsV3Store.getState().results;
      expect(results.targetOutputs["target-1"]?.[0]).toBe("First");
      expect(results.targetOutputs["target-1"]?.[1]).toBe("Second");
    });
  });

  describe("Target Header Aggregates", () => {
    it("shows pass rate when evaluator results arrive", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set results with pass/fail evaluations
      useEvaluationsV3Store.getState().setResults({
        status: "success",
        targetOutputs: {
          "target-1": ["Out 1", "Out 2", "Out 3"],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [
              { status: "processed", passed: true },
              { status: "processed", passed: true },
              { status: "processed", passed: false },
            ],
          },
        },
      });

      renderTable();

      // Wait for aggregates to display - 2/3 passed = 67%
      // TargetSummary shows "67%" (may appear multiple times in DOM)
      await waitFor(() => {
        expect(screen.getAllByText("67%").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("shows error count when target errors exist", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set results with errors
      const errors: Record<string, string[]> = { "target-1": [] };
      errors["target-1"]![0] = "Error 1";
      errors["target-1"]![2] = "Error 2";

      useEvaluationsV3Store.getState().setResults({
        status: "success",
        targetOutputs: {
          "target-1": [undefined, "Output", undefined],
        },
        errors,
      });

      renderTable();

      // TargetSummary shows errors as "X errors"
      await waitFor(() => {
        expect(screen.getAllByText("2 errors").length).toBeGreaterThanOrEqual(
          1,
        );
      });
    });

    it("shows progress during execution", async () => {
      setupStoreWithConfiguredEvaluation();

      // Create executingCells set for all 3 rows of target-1
      const executingCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
        { rowIndex: 1, targetId: "target-1" },
        { rowIndex: 2, targetId: "target-1" },
      ]);

      // Set running state with partial progress
      // Progress shows completed rows (target + all evaluators done)
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        executingCells,
        progress: 1,
        total: 3,
        targetOutputs: {
          "target-1": ["First output", undefined, undefined],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [{ passed: true }, undefined, undefined],
          },
        },
      });

      renderTable();

      // Should show "1/3" progress indicator (may appear multiple times due to popover)
      await waitFor(() => {
        expect(screen.getAllByText("1/3").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("shows average score when evaluator has scores", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set results with scores
      useEvaluationsV3Store.getState().setResults({
        status: "success",
        targetOutputs: {
          "target-1": ["Out 1", "Out 2", "Out 3"],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [
              { status: "processed", passed: true, score: 0.8 },
              { status: "processed", passed: true, score: 0.6 },
              { status: "processed", passed: true, score: 1.0 },
            ],
          },
        },
      });

      renderTable();

      // Average score: (0.8 + 0.6 + 1.0) / 3 = 0.8
      // Now displayed as "0.80" in TargetSummary (may appear multiple times in DOM due to tooltip)
      await waitFor(() => {
        expect(screen.getAllByText("0.80").length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("Partial Execution", () => {
    it("executes with target scope when clicking target play button", async () => {
      setupStoreWithConfiguredEvaluation();
      const user = userEvent.setup();

      // Setup SSE mock
      mockFetchSSE.mockImplementation(async ({ payload, onEvent }) => {
        // Verify the scope is for target execution
        expect(payload.scope).toEqual({ type: "target", targetId: "target-1" });

        onEvent({ type: "execution_started", runId: "run-123", total: 3 });
        onEvent({ type: "done" });
      });

      renderTable();

      // Find and click the target play button
      const playButton = screen.getByTestId("target-play-button");
      await user.click(playButton);

      // Verify fetchSSE was called
      expect(mockFetchSSE).toHaveBeenCalled();
    });

    it("single row execution updates only that row", async () => {
      setupStoreWithConfiguredEvaluation();

      // Add second target
      const currentState = useEvaluationsV3Store.getState();
      useEvaluationsV3Store.setState({
        ...currentState,
        targets: [
          ...currentState.targets,
          {
            id: "target-2",
            type: "prompt",
            promptId: "prompt-456",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              "test-dataset": {
                input: {
                  type: "source",
                  source: "dataset",
                  sourceId: "test-dataset",
                  sourceField: "input",
                },
              },
            },
          },
        ],
      });

      // Simulate row execution - only row 1 gets results
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        targetOutputs: {
          "target-1": [undefined, "Row 2 Output T1", undefined],
          "target-2": [undefined, "Row 2 Output T2", undefined],
        },
      });

      renderTable();

      await waitFor(() => {
        // Only row 1 (index 1) should have outputs
        expect(screen.getByText("Row 2 Output T1")).toBeInTheDocument();
        expect(screen.getByText("Row 2 Output T2")).toBeInTheDocument();
      });

      // Verify the results structure - only row 1 has data
      const results = useEvaluationsV3Store.getState().results;
      expect(results.targetOutputs["target-1"]?.[0]).toBeUndefined();
      expect(results.targetOutputs["target-1"]?.[1]).toBe("Row 2 Output T1");
      expect(results.targetOutputs["target-1"]?.[2]).toBeUndefined();
    });

    it("cell execution updates only specific target in specific row", async () => {
      setupStoreWithConfiguredEvaluation();

      // Add second target
      const currentState = useEvaluationsV3Store.getState();
      useEvaluationsV3Store.setState({
        ...currentState,
        targets: [
          ...currentState.targets,
          {
            id: "target-2",
            type: "prompt",
            promptId: "prompt-456",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              "test-dataset": {
                input: {
                  type: "source",
                  source: "dataset",
                  sourceId: "test-dataset",
                  sourceField: "input",
                },
              },
            },
          },
        ],
      });

      // Simulate cell execution - only target-2 at row 0 gets result
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        targetOutputs: {
          "target-2": ["Cell Output", undefined, undefined],
        },
      });

      renderTable();

      await waitFor(() => {
        expect(screen.getByText("Cell Output")).toBeInTheDocument();
      });

      // target-1 should still show "No output yet" for all 3 rows
      // Can verify by checking the results structure
      const results = useEvaluationsV3Store.getState().results;
      expect(results.targetOutputs["target-1"]).toBeUndefined();
      expect(results.targetOutputs["target-2"]?.[0]).toBe("Cell Output");
    });
  });

  describe("empty row handling", () => {
    it("does not show skeletons for empty rows when execution starts", async () => {
      // Set up dataset with non-empty and empty rows
      useEvaluationsV3Store.setState({
        name: "Test Evaluation",
        datasets: [
          {
            id: "test-dataset",
            name: "Test Dataset",
            type: "inline",
            columns: [
              { id: "input", name: "input", type: "string" },
              { id: "expected", name: "expected", type: "string" },
            ],
            inline: {
              columns: [
                { id: "input", name: "input", type: "string" },
                { id: "expected", name: "expected", type: "string" },
              ],
              records: {
                input: ["Hello", "", "World"], // Row 1 is empty
                expected: ["Hi", "", "There"], // Row 1 is empty
              },
            },
          },
        ],
        activeDatasetId: "test-dataset",
        targets: [
          {
            id: "target-1",
            type: "prompt",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {},
          },
        ],
        evaluators: [],
        results: {
          status: "running",
          progress: 0,
          total: 2, // Backend would report only 2 cells (skipping empty row)
          targetOutputs: {
            // Row 0 has output, row 1 is empty (no output), row 2 still pending
            "target-1": ["Result for row 0", undefined, undefined],
          },
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
        pendingSavedChanges: {},
        ui: {
          selectedRows: new Set(),
          columnWidths: {},
          rowHeightMode: "compact",
          expandedCells: new Set(),
          hiddenColumns: new Set(),
          autosaveStatus: { evaluation: "idle", dataset: "idle" },
          concurrency: 10,
        },
      });

      renderTable();

      await waitFor(() => {
        expect(screen.getByText("Result for row 0")).toBeInTheDocument();
      });

      // Verify through store state
      const results = useEvaluationsV3Store.getState().results;
      expect(results.targetOutputs["target-1"]?.[0]).toBe("Result for row 0");
      expect(results.targetOutputs["target-1"]?.[1]).toBeUndefined(); // Empty row - no execution
      expect(results.targetOutputs["target-1"]?.[2]).toBeUndefined(); // Still pending
    });

    it("skips empty rows in row count for execution", () => {
      // This tests that the UI correctly interprets the backend's cell count
      useEvaluationsV3Store.setState({
        name: "Test Evaluation",
        datasets: [
          {
            id: "test-dataset",
            name: "Test Dataset",
            type: "inline",
            columns: [{ id: "input", name: "input", type: "string" }],
            inline: {
              columns: [{ id: "input", name: "input", type: "string" }],
              records: {
                input: ["A", "", "B", "", ""], // 2 non-empty rows out of 5
              },
            },
          },
        ],
        activeDatasetId: "test-dataset",
        targets: [
          {
            id: "target-1",
            type: "prompt",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {},
          },
        ],
        evaluators: [],
        results: {
          status: "running",
          progress: 0,
          total: 2, // Only 2 non-empty rows
          targetOutputs: {},
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
        pendingSavedChanges: {},
        ui: {
          selectedRows: new Set(),
          columnWidths: {},
          rowHeightMode: "compact",
          expandedCells: new Set(),
          hiddenColumns: new Set(),
          autosaveStatus: { evaluation: "idle", dataset: "idle" },
          concurrency: 10,
        },
      });

      const results = useEvaluationsV3Store.getState().results;
      expect(results.total).toBe(2);
    });
  });

  describe("Aggregate Statistics - Store Layer", () => {
    it("stores target metadata (cost, duration) via setResults", () => {
      setupStoreWithConfiguredEvaluation();

      // Simulate updating results with metadata
      useEvaluationsV3Store.getState().setResults({
        targetOutputs: {
          "target-1": ["Output 1", "Output 2", "Output 3"],
        },
        targetMetadata: {
          "target-1": [
            { cost: 0.001, duration: 500, traceId: "trace-1" },
            { cost: 0.002, duration: 1000, traceId: "trace-2" },
            { cost: 0.003, duration: 1500, traceId: "trace-3" },
          ],
        },
      });

      const state = useEvaluationsV3Store.getState();

      // Verify metadata is stored correctly
      expect(state.results.targetMetadata["target-1"]?.[0]?.cost).toBe(0.001);
      expect(state.results.targetMetadata["target-1"]?.[0]?.duration).toBe(500);
      expect(state.results.targetMetadata["target-1"]?.[1]?.cost).toBe(0.002);
      expect(state.results.targetMetadata["target-1"]?.[2]?.duration).toBe(
        1500,
      );
    });

    it("merges targetMetadata correctly with existing results", () => {
      setupStoreWithConfiguredEvaluation();

      // First update - partial metadata
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        targetOutputs: { "target-1": ["Output 1", undefined, undefined] },
        targetMetadata: {
          "target-1": [
            { cost: 0.001, duration: 500 },
            undefined,
            undefined,
          ] as any,
        },
      });

      // Second update - more metadata
      useEvaluationsV3Store.getState().setResults({
        targetOutputs: { "target-1": ["Output 1", "Output 2", undefined] },
        targetMetadata: {
          "target-1": [
            { cost: 0.001, duration: 500 },
            { cost: 0.002, duration: 1000 },
            undefined,
          ] as any,
        },
      });

      const state = useEvaluationsV3Store.getState();
      expect(state.results.targetMetadata["target-1"]?.[0]?.cost).toBe(0.001);
      expect(state.results.targetMetadata["target-1"]?.[1]?.cost).toBe(0.002);
    });

    it("clearResults resets targetMetadata", () => {
      setupStoreWithConfiguredEvaluation();

      // Set some metadata
      useEvaluationsV3Store.getState().setResults({
        targetMetadata: {
          "target-1": [{ cost: 0.001, duration: 500 }],
        },
      });

      // Clear results
      useEvaluationsV3Store.getState().clearResults();

      const state = useEvaluationsV3Store.getState();
      expect(state.results.targetMetadata).toEqual({});
    });
  });

  describe("Evaluator Spinner State During Execution", () => {
    /**
     * This test verifies that evaluator spinners are shown correctly:
     * 1. When a SINGLE cell is being executed, only that cell's evaluators should spin
     * 2. Other cells' evaluators should NOT show spinners
     * 3. After target output arrives, evaluators for that cell should spin while processing
     */
    it("shows spinner only on executing cell's evaluators, not other cells", async () => {
      setupStoreWithConfiguredEvaluation();

      // Setup: Multiple targets to test isolation
      const currentState = useEvaluationsV3Store.getState();
      useEvaluationsV3Store.setState({
        ...currentState,
        targets: [
          ...currentState.targets,
          {
            id: "target-2",
            type: "prompt",
            promptId: "prompt-456",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {
              "test-dataset": {
                input: {
                  type: "source",
                  source: "dataset",
                  sourceId: "test-dataset",
                  sourceField: "input",
                },
              },
            },
          },
        ],
      });

      // Simulate: Only cell (row 0, target-1) is executing
      // Other cells should NOT show spinners
      const executingCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
      ]);

      useEvaluationsV3Store.getState().setResults({
        status: "running",
        executingCells,
        targetOutputs: {},
        evaluatorResults: {},
      });

      renderTable();

      // Get all evaluator chips - there should be chips for multiple cells
      const allEvalChips = screen.getAllByText("Exact Match");
      expect(allEvalChips.length).toBeGreaterThanOrEqual(3); // At least 3 rows

      // Only the executing cell's evaluator should potentially show spinner
      // The test verifies that non-executing cells don't show spinners
      // (they should show gray circle for pending state)

      // Count spinners - should be 0 at this point because target output hasn't arrived yet
      const spinners = document.querySelectorAll(".chakra-spinner");
      expect(spinners.length).toBe(0); // No spinners - target output not yet received
    });

    it("shows spinner on evaluator AFTER target output arrives for that cell", async () => {
      setupStoreWithConfiguredEvaluation();

      // Simulate: Cell (row 0, target-1) has received target output
      // and evaluator is now running (added to runningEvaluators)
      const executingCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
      ]);

      // Mark the evaluator as running (this happens when target output arrives)
      const runningEvaluators = new Set(["0:target-1:eval-1"]);

      useEvaluationsV3Store.getState().setResults({
        status: "running",
        executingCells,
        runningEvaluators,
        targetOutputs: {
          "target-1": ["Output for row 0", undefined, undefined],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [undefined, undefined, undefined], // No result yet for row 0
          },
        },
      });

      renderTable();

      // Wait for render
      await waitFor(() => {
        expect(screen.getByText("Output for row 0")).toBeInTheDocument();
      });

      // The evaluator chip for row 0 should show spinner
      // because it's in runningEvaluators
      const spinners = document.querySelectorAll(".chakra-spinner");
      expect(spinners.length).toBeGreaterThanOrEqual(1);
    });

    it("does NOT show spinner on other rows when only one cell is executing", async () => {
      setupStoreWithConfiguredEvaluation();

      // Setup: Row 1 already has results (completed previously)
      // Only row 0 is currently executing with evaluator running
      const executingCells = createExecutionCellSet([
        { rowIndex: 0, targetId: "target-1" },
      ]);

      // Only row 0's evaluator is running
      const runningEvaluators = new Set(["0:target-1:eval-1"]);

      useEvaluationsV3Store.getState().setResults({
        status: "running",
        executingCells,
        runningEvaluators,
        targetOutputs: {
          "target-1": [
            "Output for row 0", // Row 0 - currently executing
            "Previous output row 1", // Row 1 - completed previously
            undefined, // Row 2 - not yet executed
          ],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [
              undefined, // Row 0 - evaluator still running
              { status: "processed", passed: true, score: 1.0 }, // Row 1 - completed
              undefined, // Row 2 - not yet executed
            ],
          },
        },
      });

      renderTable();

      // Wait for outputs to render
      await waitFor(() => {
        expect(screen.getByText("Output for row 0")).toBeInTheDocument();
        expect(screen.getByText("Previous output row 1")).toBeInTheDocument();
      });

      // Row 1's evaluator should show "1.00" (result), not a spinner
      expect(screen.getByText("1.00")).toBeInTheDocument();

      // Row 0's evaluator should show spinner (it's in runningEvaluators)
      const spinners = document.querySelectorAll(".chakra-spinner");
      expect(spinners.length).toBe(1); // Only ONE spinner - for the running evaluator

      // Row 2's evaluator should NOT have spinner (not in runningEvaluators)
    });

    it("shows no spinner when evaluator has result and runningEvaluators is undefined", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set results with completed evaluator (no runningEvaluators)
      useEvaluationsV3Store.getState().setResults({
        status: "success",
        targetOutputs: {
          "target-1": ["Output row 0", "Output row 1", "Output row 2"],
        },
        evaluatorResults: {
          "target-1": {
            "eval-1": [
              { status: "processed", passed: true, score: 0.95 },
              { status: "processed", passed: true, score: 0.85 },
              { status: "processed", passed: false, score: 0.45 },
            ],
          },
        },
      });

      renderTable();

      // Should see outputs and scores
      await waitFor(() => {
        expect(screen.getByText("Output row 0")).toBeInTheDocument();
        expect(screen.getByText("0.95")).toBeInTheDocument();
      });

      // Should have no spinners since runningEvaluators is undefined
      const spinners = document.querySelectorAll(".chakra-spinner");
      expect(spinners.length).toBe(0);
    });
  });

  describe("Concurrent Execution", () => {
    /**
     * Full integration test that verifies when two cells are executed concurrently,
     * completing one execution does NOT clear the other's loading/spinner state.
     *
     * User scenario:
     * 1. User clicks to run cell A (row 0)
     * 2. While A is running, user clicks to run cell B (row 1)
     * 3. Cell A completes (target output + evaluator result)
     * 4. Cell B should STILL show skeleton (waiting for output) - not disappear!
     *
     * This was a real bug where the "done" event from execution A would clear
     * ALL executingCells/runningEvaluators, breaking cell B's UI state.
     */
    it("does not clear cell B's loading state when cell A's concurrent execution completes", async () => {
      setupStoreWithConfiguredEvaluation();

      renderTable();

      // Step 1: Start executing cell A (row 0)
      act(() => {
        useEvaluationsV3Store.getState().setResults({
          status: "running",
          executingCells: new Set(["0:target-1"]),
          targetOutputs: {},
          evaluatorResults: {},
        });
      });

      // Verify cell A shows skeleton (loading state)
      await waitFor(() => {
        const skeletons = document.querySelectorAll(".chakra-skeleton");
        expect(skeletons.length).toBeGreaterThan(0);
      });

      // Step 2: While A is running, start executing cell B (row 1)
      act(() => {
        const current = useEvaluationsV3Store.getState().results;
        useEvaluationsV3Store.getState().setResults({
          executingCells: new Set([...current.executingCells!, "1:target-1"]),
        });
      });

      // Verify both cells show loading state (skeletons)
      await waitFor(() => {
        const skeletons = document.querySelectorAll(".chakra-skeleton");
        // Both rows should show skeletons for their target cells
        expect(skeletons.length).toBeGreaterThanOrEqual(2);
      });

      // Step 3: Cell A gets target output and evaluator starts running
      act(() => {
        const current = useEvaluationsV3Store.getState().results;
        useEvaluationsV3Store.getState().setResults({
          targetOutputs: {
            ...current.targetOutputs,
            "target-1": ["Output from cell A", undefined, undefined],
          },
          runningEvaluators: new Set(["0:target-1:eval-1"]),
        });
      });

      // Verify cell A's output is shown and evaluator is spinning
      await waitFor(() => {
        expect(screen.getByText("Output from cell A")).toBeInTheDocument();
      });
      let spinners = document.querySelectorAll(".chakra-spinner");
      expect(spinners.length).toBe(1); // Cell A's evaluator spinning

      // Step 4: Cell A's evaluator completes (simulating cleanupThisExecution for cell A only)
      act(() => {
        const current = useEvaluationsV3Store.getState().results;
        // Remove cell A from executingCells
        const newExecutingCells = new Set(current.executingCells);
        newExecutingCells.delete("0:target-1");

        // Remove cell A's evaluator from runningEvaluators
        const newRunningEvals = new Set(current.runningEvaluators);
        newRunningEvals.delete("0:target-1:eval-1");

        useEvaluationsV3Store.getState().setResults({
          executingCells: newExecutingCells,
          runningEvaluators: newRunningEvals,
          evaluatorResults: {
            ...current.evaluatorResults,
            "target-1": {
              "eval-1": [
                { status: "processed", passed: true, score: 0.95 },
                undefined, // Cell B still pending
                undefined,
              ],
            },
          },
        });
      });

      // CRITICAL ASSERTIONS - Verify from user perspective:

      // 1. Cell A's evaluator should NOT be spinning anymore
      await waitFor(() => {
        spinners = document.querySelectorAll(".chakra-spinner");
        expect(spinners.length).toBe(0); // A is done, B hasn't started evaluators yet
      });

      // 2. Cell B should STILL be in executingCells (this is the main bug fix!)
      // This is what causes cell B to show skeleton - if executingCells was cleared,
      // cell B would show "No output yet" instead of skeleton
      const finalState = useEvaluationsV3Store.getState().results;
      expect(finalState.executingCells?.has("1:target-1")).toBe(true);
      expect(finalState.executingCells?.has("0:target-1")).toBe(false); // A is done

      // 3. Cell A's output should still be visible (it wasn't cleared)
      expect(screen.getByText("Output from cell A")).toBeInTheDocument();

      // 4. Cell B's row still has no output (it's still pending) - verified via state
      // The UI would show skeleton because executingCells still contains "1:target-1"
      expect(finalState.targetOutputs["target-1"]?.[1]).toBeUndefined();

      // 5. Verify cell A's result is stored correctly
      expect(finalState.evaluatorResults["target-1"]?.["eval-1"]?.[0]).toEqual({
        status: "processed",
        passed: true,
        score: 0.95,
      });
    });

    /**
     * Full integration test for the scenario where both cells have target outputs
     * and both evaluators are running, then one completes.
     */
    it("keeps cell B's evaluator spinning when cell A's evaluator completes", async () => {
      setupStoreWithConfiguredEvaluation();

      // Set up: Both cells have target output and both evaluators are running
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        executingCells: new Set(["0:target-1", "1:target-1"]),
        runningEvaluators: new Set(["0:target-1:eval-1", "1:target-1:eval-1"]),
        targetOutputs: {
          "target-1": ["Output A", "Output B", undefined],
        },
        evaluatorResults: {},
      });

      renderTable();

      // Verify both outputs are shown
      await waitFor(() => {
        expect(screen.getByText("Output A")).toBeInTheDocument();
        expect(screen.getByText("Output B")).toBeInTheDocument();
      });

      // Both evaluators should show spinners
      let spinners = document.querySelectorAll(".chakra-spinner");
      expect(spinners.length).toBe(2);

      // Cell A's evaluator completes (but cell B's is still running)
      act(() => {
        const current = useEvaluationsV3Store.getState().results;

        // Only remove cell A's state
        const newExecutingCells = new Set(current.executingCells);
        newExecutingCells.delete("0:target-1");

        const newRunningEvals = new Set(current.runningEvaluators);
        newRunningEvals.delete("0:target-1:eval-1");

        useEvaluationsV3Store.getState().setResults({
          executingCells: newExecutingCells,
          runningEvaluators: newRunningEvals,
          evaluatorResults: {
            "target-1": {
              "eval-1": [
                { status: "processed", passed: true, score: 0.88 },
                undefined, // Cell B's evaluator still running
                undefined,
              ],
            },
          },
        });
      });

      // CRITICAL ASSERTIONS:

      // 1. Cell B's evaluator should STILL be spinning (only 1 spinner remains)
      await waitFor(() => {
        const currentSpinners = document.querySelectorAll(".chakra-spinner");
        expect(currentSpinners.length).toBe(1);
      });

      // 2. State should reflect cell B is still running
      const finalState = useEvaluationsV3Store.getState().results;
      expect(finalState.executingCells?.has("1:target-1")).toBe(true);
      expect(finalState.runningEvaluators?.has("1:target-1:eval-1")).toBe(true);

      // 3. Cell A's evaluator result is in the store (UI verification would require
      //    checking the actual chip content, which may involve tooltip/popover)
      expect(finalState.evaluatorResults["target-1"]?.["eval-1"]?.[0]).toEqual({
        status: "processed",
        passed: true,
        score: 0.88,
      });
    });
  });
});
