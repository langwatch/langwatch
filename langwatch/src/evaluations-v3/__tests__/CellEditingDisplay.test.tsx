/**
 * @vitest-environment jsdom
 *
 * Tests that verify edited cell values are immediately visible in the table.
 * This tests the full rendering path, not just the store update.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock optimization_studio hooks to prevent circular dependency issues
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

// Mock heavy sub-components that cell editing display tests don't need
vi.mock("~/evaluations-v3/components/DatasetSuperHeader", () => ({
  DatasetSuperHeader: () => null,
}));
vi.mock("~/evaluations-v3/components/TargetSuperHeader", () => ({
  TargetSuperHeader: () => null,
}));
vi.mock("~/evaluations-v3/components/SelectionToolbar", () => ({
  SelectionToolbar: () => null,
}));

// Mock heavy hooks that cell editing display tests don't exercise
// NOTE: useDatasetSync is NOT mocked — DB sync tests in this file exercise it
vi.mock("~/evaluations-v3/hooks/useExecuteEvaluation", () => ({
  useExecuteEvaluation: () => ({
    status: "idle",
    runId: null,
    progress: { completed: 0, total: 0 },
    totalCost: 0,
    error: null,
    isAborting: false,
    execute: vi.fn(),
    rerunEvaluator: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("~/evaluations-v3/hooks/useOpenTargetEditor", () => ({
  useOpenTargetEditor: () => ({
    openTargetEditor: vi.fn(),
    buildAvailableSources: vi.fn(() => []),
    isDatasetSource: vi.fn(() => false),
  }),
  buildUIMappings: vi.fn(() => ({})),
  scrollToTargetColumn: vi.fn(),
}));
vi.mock("~/evaluations-v3/hooks/useSavedDatasetLoader", () => ({
  useSavedDatasetRecords: () => ({ isLoading: false }),
  useSavedDatasetLoader: () => ({
    isLoading: false,
    loadingCount: 0,
    datasetsToLoad: [],
  }),
  useDatasetSelectionLoader: () => ({
    loadSavedDataset: vi.fn(),
    isLoading: false,
  }),
}));

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
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    // Find the first input cell (row 0, column 'input')
    const cell = screen.getByTestId("cell-0-input");
    // Cell has initial sample data from createInitialInlineDataset

    // Double-click to enter edit mode
    await user.dblClick(cell);

    // Find the textarea and clear it, then type new value
    const textarea = await screen.findByRole("textbox");
    await user.clear(textarea);
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
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

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
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-question_0")).toHaveTextContent(
        "What is 2+2?",
      );
      expect(screen.getByTestId("cell-0-answer_1")).toHaveTextContent("4");
      expect(screen.getByTestId("cell-1-question_0")).toHaveTextContent(
        "What is the capital?",
      );
    });
  });

  it("shows updated value immediately after editing saved cell", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

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
