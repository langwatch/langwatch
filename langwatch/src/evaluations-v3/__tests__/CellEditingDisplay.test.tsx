/**
 * @vitest-environment jsdom
 *
 * Tests that verify edited cell values are immediately visible in the table.
 * This tests the full rendering path, not just the store update.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock optimization_studio hooks to prevent circular dependency issues
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

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
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

// Mock mutation function that we can spy on
const mockUpdateMutate = vi.fn();

// Mock api
vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      agents: {
        getById: {
          fetch: vi.fn(),
        },
      },
    }),
    datasetRecord: {
      getAll: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
      update: {
        useMutation: () => ({ mutate: mockUpdateMutate }),
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

// Mock AddOrEditDatasetDrawer to avoid complex API dependencies
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

describe("Cell editing display - inline dataset", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows updated value immediately after editing inline cell", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    // Find the first input cell (row 0, column 'input')
    const cell = screen.getByTestId("cell-0-input");
    expect(cell).toHaveTextContent("");

    // Double-click to enter edit mode
    await user.dblClick(cell);

    // Find the textarea and type
    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "test value");

    // Press Enter to save
    await user.keyboard("{Enter}");

    // The cell should immediately show the new value
    await waitFor(() => {
      const updatedCell = screen.getByTestId("cell-0-input");
      expect(updatedCell).toHaveTextContent("test value");
    });
  });

  it("shows updated value after editing multiple cells", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    // Edit first cell
    const cell1 = screen.getByTestId("cell-0-input");
    await user.dblClick(cell1);
    let textarea = await screen.findByRole("textbox");
    await user.type(textarea, "first");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-input")).toHaveTextContent("first");
    });

    // Edit second cell
    const cell2 = screen.getByTestId("cell-1-input");
    await user.dblClick(cell2);
    textarea = await screen.findByRole("textbox");
    await user.type(textarea, "second");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-1-input")).toHaveTextContent("second");
    });

    // Both values should still be visible
    expect(screen.getByTestId("cell-0-input")).toHaveTextContent("first");
    expect(screen.getByTestId("cell-1-input")).toHaveTextContent("second");
  });
});

describe("Cell editing display - saved dataset", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();

    // Add a saved dataset with records
    const store = useEvaluationsV3Store.getState();
    store.addDataset({
      id: "saved_test",
      name: "Test Saved",
      type: "saved",
      datasetId: "db-dataset-123",
      columns: [
        { id: "question_0", name: "question", type: "string" },
        { id: "answer_1", name: "answer", type: "string" },
      ],
      savedRecords: [
        { id: "rec1", question: "What is 2+2?", answer: "4" },
        { id: "rec2", question: "What is the capital?", answer: "Paris" },
      ],
    });
    store.setActiveDataset("saved_test");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows saved dataset values in cells", async () => {
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-question_0")).toHaveTextContent("What is 2+2?");
      expect(screen.getByTestId("cell-0-answer_1")).toHaveTextContent("4");
      expect(screen.getByTestId("cell-1-question_0")).toHaveTextContent("What is the capital?");
    });
  });

  it("shows updated value immediately after editing saved cell", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByTestId("cell-0-answer_1")).toHaveTextContent("4");
    });

    // Double-click to edit
    const cell = screen.getByTestId("cell-0-answer_1");
    await user.dblClick(cell);

    // Find textarea and update
    const textarea = await screen.findByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "four");

    // Press Enter to save
    await user.keyboard("{Enter}");

    // Value should update immediately
    await waitFor(() => {
      expect(screen.getByTestId("cell-0-answer_1")).toHaveTextContent("four");
    });
  });
});

describe("Auto-add empty row at end", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("always shows at least one empty row at the end", async () => {
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    // Should have 3 rows by default (all empty)
    expect(screen.getByTestId("cell-0-input")).toBeInTheDocument();
    expect(screen.getByTestId("cell-1-input")).toBeInTheDocument();
    expect(screen.getByTestId("cell-2-input")).toBeInTheDocument();
  });

  it("adds new row when typing in the last row", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    // Fill all 3 default rows
    for (let i = 0; i < 3; i++) {
      const cell = screen.getByTestId(`cell-${i}-input`);
      await user.dblClick(cell);
      const textarea = await screen.findByRole("textbox");
      await user.type(textarea, `row ${i}`);
      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(screen.getByTestId(`cell-${i}-input`)).toHaveTextContent(`row ${i}`);
      });
    }

    // Now a 4th row should exist (empty row at end)
    await waitFor(() => {
      expect(screen.getByTestId("cell-3-input")).toBeInTheDocument();
    });
  });
});

describe("Saved dataset - adding new rows", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();

    // Add saved dataset with 2 records
    const store = useEvaluationsV3Store.getState();
    store.addDataset({
      id: "saved_small",
      name: "Small Dataset",
      type: "saved",
      datasetId: "db-123",
      columns: [
        { id: "col1_0", name: "col1", type: "string" },
      ],
      savedRecords: [
        { id: "rec1", col1: "value1" },
        { id: "rec2", col1: "value2" },
      ],
    });
    store.setActiveDataset("saved_small");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows empty row after saved records", async () => {
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    await waitFor(() => {
      // Should show 2 saved records + at least 1 empty row
      expect(screen.getByTestId("cell-0-col1_0")).toHaveTextContent("value1");
      expect(screen.getByTestId("cell-1-col1_0")).toHaveTextContent("value2");
      expect(screen.getByTestId("cell-2-col1_0")).toHaveTextContent("");
    });
  });

  it("creates new record when typing in empty row of saved dataset", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    // Wait for initial render
    await waitFor(
      () => {
      expect(screen.getByTestId("cell-2-col1_0")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Type in the empty row (row 2)
    const cell = screen.getByTestId("cell-2-col1_0");
    await user.dblClick(cell);
    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "new value");
    await user.keyboard("{Enter}");

    // Value should appear
    await waitFor(
      () => {
      expect(screen.getByTestId("cell-2-col1_0")).toHaveTextContent("new value");
      },
      { timeout: 5000 },
    );

    // Check store has the new record
    const state = useEvaluationsV3Store.getState();
    const dataset = state.datasets.find((d) => d.id === "saved_small");
    expect(dataset?.savedRecords?.length).toBe(3);
    expect(dataset?.savedRecords?.[2]?.col1).toBe("new value");
  }, 15000);
});

describe("Saved dataset - DB sync sends full record", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useEvaluationsV3Store.getState().reset();
    mockUpdateMutate.mockClear();

    // Add saved dataset with multiple columns
    const store = useEvaluationsV3Store.getState();
    store.addDataset({
      id: "saved_multi",
      name: "Multi Column Dataset",
      type: "saved",
      datasetId: "db-multi-123",
      columns: [
        { id: "foo_0", name: "foo", type: "string" },
        { id: "bar_1", name: "bar", type: "string" },
        { id: "baz_2", name: "baz", type: "string" },
      ],
      savedRecords: [
        { id: "rec1", foo: "foo_value", bar: "bar_value", baz: "baz_value" },
      ],
    });
    store.setActiveDataset("saved_multi");
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it("sends full record to backend when editing one column (not just the changed field)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByTestId("cell-0-baz_2")).toHaveTextContent("baz_value");
    });

    // Edit only the 'baz' column (third column)
    const cell = screen.getByTestId("cell-0-baz_2");
    await user.dblClick(cell);
    const textarea = await screen.findByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "qux");
    await user.keyboard("{Enter}");

    // Wait for the value to update in UI
    await waitFor(() => {
      expect(screen.getByTestId("cell-0-baz_2")).toHaveTextContent("qux");
    });

    // Advance timers to trigger the debounced sync (500ms)
    await vi.advanceTimersByTimeAsync(600);

    // Verify the mutation was called with the FULL record, not just the changed field
    await waitFor(() => {
      expect(mockUpdateMutate).toHaveBeenCalled();
    });

    const mutationCall = mockUpdateMutate.mock.calls[0]?.[0];
    expect(mutationCall).toBeDefined();
    expect(mutationCall.projectId).toBe("test-project");
    expect(mutationCall.datasetId).toBe("db-multi-123");
    expect(mutationCall.recordId).toBe("rec1");

    // CRITICAL: The updatedRecord should contain ALL columns, not just the changed one
    expect(mutationCall.updatedRecord).toEqual({
      foo: "foo_value",  // Unchanged - should still be present
      bar: "bar_value",  // Unchanged - should still be present
      baz: "qux",        // Changed
    });
  });

  it("preserves all column values when editing different columns sequentially", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByTestId("cell-0-foo_0")).toHaveTextContent("foo_value");
    });

    // Edit 'foo' column
    const fooCell = screen.getByTestId("cell-0-foo_0");
    await user.dblClick(fooCell);
    let textarea = await screen.findByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "updated_foo");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-foo_0")).toHaveTextContent("updated_foo");
    });

    // Edit 'bar' column
    const barCell = screen.getByTestId("cell-0-bar_1");
    await user.dblClick(barCell);
    textarea = await screen.findByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "updated_bar");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-bar_1")).toHaveTextContent("updated_bar");
    });

    // Advance timers to trigger sync
    await vi.advanceTimersByTimeAsync(600);

    // Check the last mutation call has all the correct values
    await waitFor(() => {
      expect(mockUpdateMutate).toHaveBeenCalled();
    });

    // Get the last call (after both edits)
    const lastCall = mockUpdateMutate.mock.calls[mockUpdateMutate.mock.calls.length - 1]?.[0];
    expect(lastCall.updatedRecord).toEqual({
      foo: "updated_foo",
      bar: "updated_bar",
      baz: "baz_value",  // Should still have original value
    });
  });
});
