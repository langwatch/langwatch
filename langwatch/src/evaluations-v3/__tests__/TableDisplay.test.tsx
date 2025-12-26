/**
 * @vitest-environment jsdom
 *
 * Tests for table display features: column resizing, row height modes,
 * and JSON formatting.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { EvaluationsV3Table } from "../components/EvaluationsV3Table";

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
  getComplexProps: () => ({}),
}));

// Mock api
vi.mock("~/utils/api", () => ({
  api: {
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
vi.mock("~/components/agents/AgentPromptEditorDrawer", () => ({
  AgentPromptEditorDrawer: () => null,
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

describe("Column width persistence", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Store actions", () => {
    it("setColumnWidth sets width for a single column", () => {
      const store = useEvaluationsV3Store.getState();

      store.setColumnWidth("input", 300);

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.columnWidths["input"]).toBe(300);
    });

    it("setColumnWidths sets widths for multiple columns", () => {
      const store = useEvaluationsV3Store.getState();

      store.setColumnWidths({ input: 200, expected_output: 400 });

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.columnWidths["input"]).toBe(200);
      expect(updatedStore.ui.columnWidths["expected_output"]).toBe(400);
    });

    it("setColumnWidths merges with existing widths", () => {
      const store = useEvaluationsV3Store.getState();

      store.setColumnWidth("input", 300);
      store.setColumnWidths({ expected_output: 400 });

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.columnWidths["input"]).toBe(300);
      expect(updatedStore.ui.columnWidths["expected_output"]).toBe(400);
    });

    it("column widths are part of UI state", () => {
      const store = useEvaluationsV3Store.getState();

      expect(store.ui.columnWidths).toBeDefined();
      expect(typeof store.ui.columnWidths).toBe("object");
    });
  });
});

describe("Row height mode", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Store actions", () => {
    it("default row height mode is compact", () => {
      const store = useEvaluationsV3Store.getState();
      expect(store.ui.rowHeightMode).toBe("compact");
    });

    it("setRowHeightMode changes mode to expanded", () => {
      const store = useEvaluationsV3Store.getState();

      store.setRowHeightMode("expanded");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.rowHeightMode).toBe("expanded");
    });

    it("setRowHeightMode changes mode back to compact", () => {
      const store = useEvaluationsV3Store.getState();

      store.setRowHeightMode("expanded");
      store.setRowHeightMode("compact");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.rowHeightMode).toBe("compact");
    });

    it("setRowHeightMode clears expanded cells when switching modes", () => {
      const store = useEvaluationsV3Store.getState();

      // Expand a cell
      store.toggleCellExpanded(0, "input");
      expect(useEvaluationsV3Store.getState().ui.expandedCells.has("0-input")).toBe(true);

      // Switch mode
      store.setRowHeightMode("expanded");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.expandedCells.size).toBe(0);
    });
  });

  describe("Individual cell expansion", () => {
    it("toggleCellExpanded expands a cell", () => {
      const store = useEvaluationsV3Store.getState();

      store.toggleCellExpanded(0, "input");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.expandedCells.has("0-input")).toBe(true);
    });

    it("toggleCellExpanded collapses an expanded cell", () => {
      const store = useEvaluationsV3Store.getState();

      store.toggleCellExpanded(0, "input");
      store.toggleCellExpanded(0, "input");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.expandedCells.has("0-input")).toBe(false);
    });

    it("multiple cells can be expanded independently", () => {
      const store = useEvaluationsV3Store.getState();

      store.toggleCellExpanded(0, "input");
      store.toggleCellExpanded(1, "expected_output");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.expandedCells.has("0-input")).toBe(true);
      expect(updatedStore.ui.expandedCells.has("1-expected_output")).toBe(true);
      expect(updatedStore.ui.expandedCells.size).toBe(2);
    });

    it("expandedCells uses row-columnId format as key", () => {
      const store = useEvaluationsV3Store.getState();

      store.toggleCellExpanded(5, "my_column");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.expandedCells.has("5-my_column")).toBe(true);
    });
  });
});

describe("JSON formatting display", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("displays JSON values with proper formatting", async () => {
    const store = useEvaluationsV3Store.getState();

    // Set up a JSON column and value
    store.updateDataset("test-data", {
      columns: [
        { id: "input", name: "input", type: "string" },
        { id: "metadata", name: "metadata", type: "json" },
      ],
      inline: {
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "metadata", name: "metadata", type: "json" },
        ],
        records: {
          input: ["test"],
          metadata: ['{"key": "value"}'],
        },
      },
    });

    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    // The JSON should be displayed (we can check the cell exists)
    await waitFor(() => {
      expect(screen.getByTestId("cell-0-metadata")).toBeInTheDocument();
    });
  });

  it("displays list values with proper formatting", async () => {
    const store = useEvaluationsV3Store.getState();

    // Set up a list column and value
    store.updateDataset("test-data", {
      columns: [
        { id: "input", name: "input", type: "string" },
        { id: "items", name: "items", type: "list" },
      ],
      inline: {
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "items", name: "items", type: "list" },
        ],
        records: {
          input: ["test"],
          items: ['["item1", "item2"]'],
        },
      },
    });

    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-items")).toBeInTheDocument();
    });
  });
});

describe("Value truncation", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("long values are truncated for display", async () => {
    const store = useEvaluationsV3Store.getState();

    // Create a very long string (over 5000 chars)
    const longValue = "a".repeat(6000);
    store.setCellValue("test-data", 0, "input", longValue);

    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    await waitFor(() => {
      const cell = screen.getByTestId("cell-0-input");
      // The displayed content should be shorter than the original
      expect(cell.textContent?.length).toBeLessThan(6000);
    });
  });
});

describe("Sticky headers", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("table has thead element for headers", () => {
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    const thead = document.querySelector("thead");
    expect(thead).toBeInTheDocument();
  });

  it("table has multiple header rows (super header and column headers)", () => {
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    const headerRows = document.querySelectorAll("thead tr");
    expect(headerRows.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Column resize handles", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("resizer elements exist in column headers", () => {
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    const resizers = document.querySelectorAll(".resizer");
    expect(resizers.length).toBeGreaterThan(0);
  });
});
