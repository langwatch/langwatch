/**
 * @vitest-environment jsdom
 *
 * Tests for cell validation in boolean and number columns.
 * Validates input transformation and error display.
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

// Mock heavy sub-components that cell validation doesn't need
vi.mock("~/evaluations-v3/components/DatasetSuperHeader", () => ({
  DatasetSuperHeader: () => null,
}));
vi.mock("~/evaluations-v3/components/TargetSuperHeader", () => ({
  TargetSuperHeader: () => null,
}));
vi.mock("~/evaluations-v3/components/SelectionToolbar", () => ({
  SelectionToolbar: () => null,
}));

// Mock heavy hooks that cell validation doesn't exercise
vi.mock("~/evaluations-v3/hooks/useDatasetSync", () => ({
  useDatasetSync: () => {},
}));
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

describe("Number column validation", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();

    // Add dataset with number column
    const store = useEvaluationsV3Store.getState();
    store.addDataset({
      id: "num_test",
      name: "Number Test",
      type: "saved",
      datasetId: "db-num-123",
      columns: [
        { id: "input_0", name: "input", type: "string" },
        { id: "score_1", name: "score", type: "number" },
      ],
      savedRecords: [
        { id: "rec1", input: "hello", score: "" },
      ],
    });
    store.setActiveDataset("num_test");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("accepts integer and saves correctly", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-score_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "42");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-score_1")).toHaveTextContent("42");
    });
  });

  it("accepts float with period decimal separator", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-score_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "3.14");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-score_1")).toHaveTextContent("3.14");
    });
  });

  it("accepts float with comma decimal separator and normalizes to period", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-score_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "1,5");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-score_1")).toHaveTextContent("1.5");
    });
  });

  it("accepts negative numbers", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-score_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "-10");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-score_1")).toHaveTextContent("-10");
    });
  });

  it("rejects non-numeric value and shows error", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-score_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "abc");
    await user.keyboard("{Enter}");

    // Editor should still be open with error message
    await waitFor(() => {
      expect(screen.getByText(/Invalid number/i)).toBeInTheDocument();
    });

    // Cell should not have the invalid value
    expect(screen.getByTestId("cell-0-score_1")).not.toHaveTextContent("abc");
  });

  it("rejects mixed alphanumeric value", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-score_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "12abc");
    await user.keyboard("{Enter}");

    // Editor should still be open with error message
    await waitFor(() => {
      expect(screen.getByText(/Invalid number/i)).toBeInTheDocument();
    });
  });

  it("allows empty value", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    // First set a value
    const cell = screen.getByTestId("cell-0-score_1");
    await user.dblClick(cell);
    let textarea = await screen.findByRole("textbox");
    await user.type(textarea, "42");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-score_1")).toHaveTextContent("42");
    });

    // Now clear it
    await user.dblClick(screen.getByTestId("cell-0-score_1"));
    textarea = await screen.findByRole("textbox");
    await user.clear(textarea);
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-score_1")).toHaveTextContent("");
    });
  });
});

describe("Cell editing cancellation behavior", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("cancels edit on blur (click outside) without saving", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-input");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "test value");

    // Click outside (blur)
    await user.click(document.body);

    // Wait for blur timeout
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    }, { timeout: 500 });

    // Value should NOT be saved (blur cancels)
    expect(screen.getByTestId("cell-0-input")).not.toHaveTextContent("test value");
  });
});
