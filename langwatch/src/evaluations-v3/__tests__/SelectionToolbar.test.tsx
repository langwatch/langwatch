/**
 * @vitest-environment jsdom
 *
 * Tests for SelectionToolbar component and row deletion functionality.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock optimization_studio hooks to prevent circular dependency issues
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

import { EvaluationsV3Table } from "../components/EvaluationsV3Table";
import { SelectionToolbar } from "../components/SelectionToolbar";
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
vi.mock("~/components/evaluators/EvaluatorCategorySelectorDrawer", () => ({
  EvaluatorCategorySelectorDrawer: () => null,
}));
vi.mock("~/components/evaluators/EvaluatorTypeSelectorDrawer", () => ({
  EvaluatorTypeSelectorDrawer: () => null,
}));
vi.mock("~/components/evaluators/EvaluatorEditorDrawer", () => ({
  EvaluatorEditorDrawer: () => null,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("SelectionToolbar", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Component rendering", () => {
    it("renders nothing when no rows are selected", () => {
      const mockOnRun = vi.fn();
      const mockOnDelete = vi.fn();
      const mockOnClear = vi.fn();

      render(
        <SelectionToolbar
          selectedCount={0}
          onRun={mockOnRun}
          onDelete={mockOnDelete}
          onClear={mockOnClear}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("selection-count")).not.toBeInTheDocument();
    });

    it("shows selection count when rows are selected", () => {
      const mockOnRun = vi.fn();
      const mockOnDelete = vi.fn();
      const mockOnClear = vi.fn();

      render(
        <SelectionToolbar
          selectedCount={3}
          onRun={mockOnRun}
          onDelete={mockOnDelete}
          onClear={mockOnClear}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("selection-count")).toHaveTextContent(
        "3 selected",
      );
    });

    it("shows confirmation dialog when delete is clicked", async () => {
      const user = userEvent.setup();
      const mockOnRun = vi.fn();
      const mockOnDelete = vi.fn();
      const mockOnClear = vi.fn();

      render(
        <SelectionToolbar
          selectedCount={2}
          onRun={mockOnRun}
          onDelete={mockOnDelete}
          onClear={mockOnClear}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("selection-delete-btn"));

      await waitFor(() => {
        expect(screen.getByText("Delete 2 rows?")).toBeInTheDocument();
      });
    });

    it("calls onDelete when confirming deletion", async () => {
      const user = userEvent.setup();
      const mockOnRun = vi.fn();
      const mockOnDelete = vi.fn();
      const mockOnClear = vi.fn();

      render(
        <SelectionToolbar
          selectedCount={2}
          onRun={mockOnRun}
          onDelete={mockOnDelete}
          onClear={mockOnClear}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("selection-delete-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("delete-confirm-btn")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("delete-confirm-btn"));

      expect(mockOnDelete).toHaveBeenCalledTimes(1);
    });

    it("does not call onDelete when canceling deletion", async () => {
      const user = userEvent.setup();
      const mockOnRun = vi.fn();
      const mockOnDelete = vi.fn();
      const mockOnClear = vi.fn();

      render(
        <SelectionToolbar
          selectedCount={2}
          onRun={mockOnRun}
          onDelete={mockOnDelete}
          onClear={mockOnClear}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("selection-delete-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("delete-cancel-btn")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("delete-cancel-btn"));

      expect(mockOnDelete).not.toHaveBeenCalled();
    });
  });
});

describe("Row deletion - inline dataset", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Store actions", () => {
    it("deleteSelectedRows removes selected rows from inline dataset", () => {
      const store = useEvaluationsV3Store.getState();

      // Set up initial data
      store.setCellValue("test-data", 0, "input", "row 0 input");
      store.setCellValue("test-data", 1, "input", "row 1 input");
      store.setCellValue("test-data", 2, "input", "row 2 input");

      // Select rows 0 and 2
      store.toggleRowSelection(0);
      store.toggleRowSelection(2);

      // Delete selected rows
      store.deleteSelectedRows("test-data");

      // Verify only row 1 remains (but now at index 0)
      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.getCellValue("test-data", 0, "input")).toBe(
        "row 1 input",
      );
      expect(updatedStore.getRowCount("test-data")).toBe(1);
    });

    it("deleteSelectedRows clears row selection after delete", () => {
      const store = useEvaluationsV3Store.getState();

      store.setCellValue("test-data", 0, "input", "row 0");
      store.toggleRowSelection(0);

      // Get fresh state after toggle
      expect(useEvaluationsV3Store.getState().ui.selectedRows.size).toBe(1);

      store.deleteSelectedRows("test-data");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.selectedRows.size).toBe(0);
    });

    it("deleteSelectedRows preserves at least one empty row when all are deleted", () => {
      const store = useEvaluationsV3Store.getState();

      // Default dataset has 3 empty rows
      // Select all rows
      store.toggleRowSelection(0);
      store.toggleRowSelection(1);
      store.toggleRowSelection(2);

      store.deleteSelectedRows("test-data");

      const updatedStore = useEvaluationsV3Store.getState();
      // Should still have 1 empty row
      expect(updatedStore.getRowCount("test-data")).toBe(1);
      expect(updatedStore.getCellValue("test-data", 0, "input")).toBe("");
    });

    it("deleteSelectedRows deletes rows in correct order (no index shifting issues)", () => {
      const store = useEvaluationsV3Store.getState();

      store.setCellValue("test-data", 0, "input", "A");
      store.setCellValue("test-data", 1, "input", "B");
      store.setCellValue("test-data", 2, "input", "C");
      store.setCellValue("test-data", 3, "input", "D");
      store.setCellValue("test-data", 4, "input", "E");

      // Select non-consecutive rows
      store.toggleRowSelection(1); // B
      store.toggleRowSelection(3); // D

      store.deleteSelectedRows("test-data");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.getRowCount("test-data")).toBe(3);
      expect(updatedStore.getCellValue("test-data", 0, "input")).toBe("A");
      expect(updatedStore.getCellValue("test-data", 1, "input")).toBe("C");
      expect(updatedStore.getCellValue("test-data", 2, "input")).toBe("E");
    });
  });
});

describe("Selected row visual indication", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("adds data-selected attribute to selected rows", async () => {
    const store = useEvaluationsV3Store.getState();
    store.setCellValue("test-data", 0, "input", "row 0");
    store.setCellValue("test-data", 1, "input", "row 1");
    store.toggleRowSelection(0);

    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    await waitFor(() => {
      const rows = document.querySelectorAll("tbody tr");
      expect(rows[0]).toHaveAttribute("data-selected", "true");
      expect(rows[1]).not.toHaveAttribute("data-selected");
    });
  });
});
