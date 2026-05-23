/**
 * @vitest-environment jsdom
 *
 * Unit tests for useOpenTargetEditor hook.
 * Specifically tests HTTP agent edit routing (Issue #1194).
 *
 * Acceptance criteria:
 * - When clicking edit on an HTTP agent target, the HTTP editor drawer opens
 * - The drawer should be agentHttpEditor (not agentCodeEditor)
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock optimization_studio hooks to prevent circular dependency issues
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

import type { TargetConfig } from "../../types";
import { useEvaluationsV3Store } from "../useEvaluationsV3Store";
import { useOpenTargetEditor } from "../useOpenTargetEditor";

// Mock useDrawer hook
const mockOpenDrawer = vi.fn();
const mockCloseDrawer = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockCloseDrawer,
    canGoBack: false,
    drawerOpen: vi.fn(() => false),
  }),
  setFlowCallbacks: vi.fn(),
  getComplexProps: () => ({}),
  useDrawerParams: () => ({}),
  getFlowCallbacks: () => ({}),
}));

// Mock project hook
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

// Mock tRPC API
const mockAgentFetch = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      agents: {
        getById: {
          fetch: mockAgentFetch,
        },
      },
    }),
  },
}));

/**
 * Setup the store with minimal state for testing
 */
const setupStore = () => {
  useEvaluationsV3Store.setState({
    name: "Test Evaluation",
    experimentId: "exp-123",
    experimentSlug: "test-eval",
    datasets: [
      {
        id: "dataset-1",
        name: "Test Dataset",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
        inline: {
          columns: [{ id: "input", name: "input", type: "string" }],
          records: { input: ["Hello", "World"] },
        },
      },
    ],
    activeDatasetId: "dataset-1",
    targets: [],
    evaluators: [],
    results: {
      status: "idle",
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    },
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
      hasRunThisSession: false,
    },
  });
};

/**
 * Create a mock agent target configuration
 */
const createAgentTarget = (
  id: string,
  dbAgentId: string,
): TargetConfig & { type: "agent" } => ({
  id,
  type: "agent",
  dbAgentId,
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    "dataset-1": {
      input: {
        type: "source",
        source: "dataset",
        sourceId: "dataset-1",
        sourceField: "input",
      },
    },
  },
});

describe("useOpenTargetEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  describe("HTTP agent edit routing", () => {
    it("opens agentHttpEditor drawer when editing an HTTP agent target", async () => {
      // Arrange: Mock the agent API to return an HTTP agent
      mockAgentFetch.mockResolvedValue({
        id: "agent-1",
        name: "My API Agent",
        type: "http",
        config: {
          url: "https://api.example.com/chat",
          method: "POST",
          bodyTemplate: '{"messages": {{messages}}}',
          outputPath: "$.response",
        },
      });

      const target = createAgentTarget("target-1", "agent-1");

      const { result } = renderHook(() => useOpenTargetEditor());

      // Act: Open the target editor
      await act(async () => {
        await result.current.openTargetEditor(target);
      });

      // Assert: agentHttpEditor is opened with correct params
      await waitFor(() => {
        expect(mockOpenDrawer).toHaveBeenCalledWith(
          "agentHttpEditor",
          expect.objectContaining({
            urlParams: expect.objectContaining({
              targetId: "target-1",
              agentId: "agent-1",
            }),
          }),
        );
      });

      // Ensure code editor was NOT opened
      expect(mockOpenDrawer).not.toHaveBeenCalledWith(
        "agentCodeEditor",
        expect.anything(),
      );
    });

    it("opens agentCodeEditor drawer when editing a code agent target", async () => {
      // Arrange: Mock the agent API to return a code agent
      mockAgentFetch.mockResolvedValue({
        id: "agent-2",
        name: "Code Agent",
        type: "code",
        config: {
          code: "def run(input): return input",
          language: "python",
        },
      });

      const target = createAgentTarget("target-2", "agent-2");

      const { result } = renderHook(() => useOpenTargetEditor());

      // Act: Open the target editor
      await act(async () => {
        await result.current.openTargetEditor(target);
      });

      // Assert: agentCodeEditor is opened (not agentHttpEditor)
      await waitFor(() => {
        expect(mockOpenDrawer).toHaveBeenCalledWith(
          "agentCodeEditor",
          expect.objectContaining({
            urlParams: expect.objectContaining({
              targetId: "target-2",
              agentId: "agent-2",
            }),
          }),
        );
      });

      // Ensure HTTP editor was NOT opened
      expect(mockOpenDrawer).not.toHaveBeenCalledWith(
        "agentHttpEditor",
        expect.anything(),
      );
    });

    it("opens workflow in new tab for workflow agent target", async () => {
      // Arrange: Mock window.open and the agent API
      const mockWindowOpen = vi.spyOn(window, "open").mockImplementation(() => null);

      mockAgentFetch.mockResolvedValue({
        id: "agent-3",
        name: "Workflow Agent",
        type: "workflow",
        config: {
          workflowId: "workflow-123",
        },
      });

      const target = createAgentTarget("target-3", "agent-3");

      const { result } = renderHook(() => useOpenTargetEditor());

      // Act: Open the target editor
      await act(async () => {
        await result.current.openTargetEditor(target);
      });

      // Assert: Window.open was called with workflow URL
      await waitFor(() => {
        expect(mockWindowOpen).toHaveBeenCalledWith(
          "/test-project/studio/workflow-123",
          "_blank",
        );
      });

      // Ensure no drawer was opened
      expect(mockOpenDrawer).not.toHaveBeenCalled();

      mockWindowOpen.mockRestore();
    });

    it("does not open any drawer when agent has no dbAgentId", async () => {
      // Arrange: Create target without dbAgentId
      const target: TargetConfig = {
        id: "target-4",
        type: "agent",
        dbAgentId: undefined,
        inputs: [],
        outputs: [],
        mappings: {},
      };

      const { result } = renderHook(() => useOpenTargetEditor());

      // Act: Try to open the target editor
      await act(async () => {
        await result.current.openTargetEditor(target);
      });

      // Assert: No drawer opened, no API called
      expect(mockAgentFetch).not.toHaveBeenCalled();
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });
});
