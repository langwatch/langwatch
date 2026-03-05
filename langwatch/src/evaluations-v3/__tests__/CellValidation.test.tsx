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

describe("Boolean column validation", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();

    // Add dataset with boolean column
    const store = useEvaluationsV3Store.getState();
    store.addDataset({
      id: "bool_test",
      name: "Boolean Test",
      type: "saved",
      datasetId: "db-bool-123",
      columns: [
        { id: "input_0", name: "input", type: "string" },
        { id: "expected_1", name: "expected", type: "boolean" },
      ],
      savedRecords: [
        { id: "rec1", input: "hello", expected: "" },
      ],
    });
    store.setActiveDataset("bool_test");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("accepts 'true' and saves as 'true'", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "true");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-expected_1")).toHaveTextContent("true");
    });
  });

  it("accepts 'TRUE' (case insensitive) and normalizes to 'true'", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "TRUE");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-expected_1")).toHaveTextContent("true");
    });
  });

  it("accepts '1' and normalizes to 'true'", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "1");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-expected_1")).toHaveTextContent("true");
    });
  });

  it("accepts 'false' and saves as 'false'", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "false");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-expected_1")).toHaveTextContent("false");
    });
  });

  it("accepts '0' and normalizes to 'false'", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "0");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cell-0-expected_1")).toHaveTextContent("false");
    });
  });

  it("rejects invalid boolean value and shows error", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "invalid");
    await user.keyboard("{Enter}");

    // Editor should still be open with error message
    await waitFor(() => {
      expect(screen.getByText(/Invalid value/i)).toBeInTheDocument();
    });

    // Cell should not have the invalid value
    expect(screen.getByTestId("cell-0-expected_1")).not.toHaveTextContent("invalid");
  });

  it("cancels without saving when pressing Escape", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    const textarea = await screen.findByRole("textbox");
    await user.type(textarea, "true");
    await user.keyboard("{Escape}");

    // Value should NOT be saved
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("cell-0-expected_1")).not.toHaveTextContent("true");
  });

  it("shows true/false quick buttons for boolean cells", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    // Should see true and false buttons
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "true" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "false" })).toBeInTheDocument();
    });
  });

  it("saves 'true' immediately when clicking true button", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    const trueButton = await screen.findByRole("button", { name: "true" });
    await user.click(trueButton);

    // Should save immediately and close editor
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByTestId("cell-0-expected_1")).toHaveTextContent("true");
    });
  });

  it("saves 'false' immediately when clicking false button", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    const cell = screen.getByTestId("cell-0-expected_1");
    await user.dblClick(cell);

    const falseButton = await screen.findByRole("button", { name: "false" });
    await user.click(falseButton);

    // Should save immediately and close editor
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByTestId("cell-0-expected_1")).toHaveTextContent("false");
    });
  });
});
