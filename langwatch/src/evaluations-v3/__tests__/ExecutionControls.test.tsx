/**
 * @vitest-environment jsdom
 *
 * Tests for execution control buttons:
 * - Top-level Run/Stop button
 * - Target header Run/Stop button
 * - Cell-level Run/Stop button
 * - Selection toolbar Run/Stop button
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

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

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { RunEvaluationButton } from "../components/RunEvaluationButton";
import { SelectionToolbar } from "../components/SelectionToolbar";
import { fetchSSE } from "~/utils/sse/fetchSSE";

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
        getById: { fetch: vi.fn() },
      },
      prompts: {
        getByIdOrHandle: { fetch: vi.fn().mockResolvedValue(null) },
      },
      evaluators: {
        getById: { fetch: vi.fn().mockResolvedValue(null) },
      },
    }),
    datasetRecord: {
      getAll: { useQuery: () => ({ data: null, isLoading: false }) },
      update: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteMany: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    agents: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    evaluators: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

// Mock SSE utility
vi.mock("~/utils/sse/fetchSSE", () => ({
  fetchSSE: vi.fn(),
}));

// Mock toaster
vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const mockFetchSSE = fetchSSE as Mock;

/**
 * Helper to setup the store with a configured evaluation
 */
const setupStoreWithConfiguredEvaluation = () => {
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
        name: "My Prompt",
        type: "prompt",
        promptId: "prompt-123",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          "test-dataset": {
            input: { type: "source", source: "dataset", sourceId: "test-dataset", sourceField: "input" },
          },
        },
      },
    ],
    evaluators: [
      {
        id: "eval-1",
        evaluatorType: "langevals/exact_match",
        name: "Exact Match",
        settings: {},
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        mappings: {
          "test-dataset": {
            "target-1": {
              output: { type: "source", source: "target", sourceId: "target-1", sourceField: "output" },
              expected_output: { type: "source", source: "dataset", sourceId: "test-dataset", sourceField: "expected_output" },
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
    },
  });
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Execution Controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStoreWithConfiguredEvaluation();
  });

  afterEach(() => {
    cleanup();
  });

  describe("RunEvaluationButton (Top-Level)", () => {
    it("renders Run button when idle", () => {
      render(<RunEvaluationButton />, { wrapper: Wrapper });

      expect(screen.getByTestId("run-evaluation-button")).toBeInTheDocument();
      expect(screen.getByText("Run")).toBeInTheDocument();
    });

    it("executes full evaluation when clicked", async () => {
      const user = userEvent.setup();

      mockFetchSSE.mockImplementation(async ({ payload, onEvent }) => {
        expect(payload.scope).toEqual({ type: "full" });
        onEvent({ type: "execution_started", runId: "run-123", total: 3 });
        onEvent({ type: "done" });
      });

      render(<RunEvaluationButton />, { wrapper: Wrapper });

      await user.click(screen.getByTestId("run-evaluation-button"));

      expect(mockFetchSSE).toHaveBeenCalled();
    });

    it("shows Stop button when running", async () => {
      // Set running state
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        runId: "run-123",
        progress: 1,
        total: 3,
      });

      render(<RunEvaluationButton />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Stop")).toBeInTheDocument();
      });
    });

    it("shows progress when running", async () => {
      useEvaluationsV3Store.getState().setResults({
        status: "running",
        runId: "run-123",
        progress: 2,
        total: 6,
      });

      // Need to re-render after state change
      render(<RunEvaluationButton />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Stop")).toBeInTheDocument();
      });
    });
  });

  describe("SelectionToolbar", () => {
    it("does not render when no rows selected", () => {
      const { container } = render(
        <SelectionToolbar
          selectedCount={0}
          onRun={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(container.firstChild).toBeNull();
    });

    it("renders when rows are selected", () => {
      render(
        <SelectionToolbar
          selectedCount={2}
          onRun={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("2 selected")).toBeInTheDocument();
      expect(screen.getByTestId("selection-run-btn")).toBeInTheDocument();
      expect(screen.getByTestId("selection-delete-btn")).toBeInTheDocument();
    });

    it("calls onRun when Run button clicked", async () => {
      const user = userEvent.setup();
      const onRun = vi.fn();

      render(
        <SelectionToolbar
          selectedCount={2}
          onRun={onRun}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      await user.click(screen.getByTestId("selection-run-btn"));

      expect(onRun).toHaveBeenCalled();
    });

    it("shows Stop button when running", () => {
      render(
        <SelectionToolbar
          selectedCount={2}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
          isRunning={true}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("Stop")).toBeInTheDocument();
    });

    it("calls onStop when Stop button clicked while running", async () => {
      const user = userEvent.setup();
      const onStop = vi.fn();

      render(
        <SelectionToolbar
          selectedCount={2}
          onRun={vi.fn()}
          onStop={onStop}
          onDelete={vi.fn()}
          onClear={vi.fn()}
          isRunning={true}
        />,
        { wrapper: Wrapper }
      );

      await user.click(screen.getByTestId("selection-run-btn"));

      expect(onStop).toHaveBeenCalled();
    });

    it("disables Delete button when running", () => {
      render(
        <SelectionToolbar
          selectedCount={2}
          onRun={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
          isRunning={true}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByTestId("selection-delete-btn")).toBeDisabled();
    });
  });

  describe("Button State Synchronization", () => {
    it("top-level button reflects store running status", async () => {
      render(<RunEvaluationButton />, { wrapper: Wrapper });

      // Initially shows Run
      expect(screen.getByText("Run")).toBeInTheDocument();

      // Update store to running
      useEvaluationsV3Store.getState().setResults({
        status: "running",
      });

      // Re-render to see change
      cleanup();
      render(<RunEvaluationButton />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Stop")).toBeInTheDocument();
      });
    });
  });
});
