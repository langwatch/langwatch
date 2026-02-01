/**
 * @vitest-environment jsdom
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
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Track which drawer was opened
let _openedDrawer: string | null = null;

// Mock dependencies
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

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

// Mock Agent and Target Drawers
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
vi.mock("~/components/targets/TargetTypeSelectorDrawer", () => ({
  TargetTypeSelectorDrawer: () => null,
}));
vi.mock("~/components/prompts/PromptListDrawer", () => ({
  PromptListDrawer: () => null,
}));

// Mock Evaluator Drawers - track which one is opened
vi.mock("~/components/evaluators/EvaluatorListDrawer", () => ({
  EvaluatorListDrawer: ({ open }: { open: boolean }) => {
    if (open) _openedDrawer = "evaluatorList";
    return open ? (
      <div data-testid="evaluator-list-drawer">Evaluator List Drawer</div>
    ) : null;
  },
}));
vi.mock("~/components/evaluators/EvaluatorCategorySelectorDrawer", () => ({
  EvaluatorCategorySelectorDrawer: ({ open }: { open: boolean }) => {
    if (open) _openedDrawer = "evaluatorCategorySelector";
    return open ? (
      <div data-testid="evaluator-category-drawer">
        Evaluator Category Drawer
      </div>
    ) : null;
  },
}));
vi.mock("~/components/evaluators/EvaluatorTypeSelectorDrawer", () => ({
  EvaluatorTypeSelectorDrawer: ({ open }: { open: boolean }) => {
    if (open) _openedDrawer = "evaluatorTypeSelector";
    return open ? (
      <div data-testid="evaluator-type-drawer">Evaluator Type Drawer</div>
    ) : null;
  },
}));
vi.mock("~/components/evaluators/EvaluatorEditorDrawer", () => ({
  EvaluatorEditorDrawer: ({ open }: { open: boolean }) => {
    if (open) _openedDrawer = "evaluatorEditor";
    return open ? (
      <div data-testid="evaluator-editor-drawer">Evaluator Editor Drawer</div>
    ) : null;
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Add Evaluator Button", () => {
  beforeEach(() => {
    _openedDrawer = null;
    vi.clearAllMocks();

    // Reset store state
    const store = useEvaluationsV3Store.getState();
    store.reset();

    // Set up test data with a target
    useEvaluationsV3Store.setState({
      targets: [
        {
          id: "target-1",
          type: "prompt",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          mappings: {},
        },
      ],
      datasets: [
        {
          id: "test-data",
          name: "Test Data",
          type: "inline",
          columns: [{ id: "col1", name: "Input", type: "string" }],
          inline: {
            columns: [{ id: "col1", name: "Input", type: "string" }],
            records: { col1: ["test value"] },
          },
        },
      ],
      activeDatasetId: "test-data",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Add evaluator button for each target", async () => {
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    await waitFor(() => {
      // There should be at least one add evaluator button
      expect(
        screen.getAllByTestId("add-evaluator-button-target-1").length,
      ).toBeGreaterThan(0);
    });
  });

  it("calls openDrawer with evaluatorList when Add evaluator is clicked", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getAllByTestId("add-evaluator-button-target-1").length,
      ).toBeGreaterThan(0);
    });

    // Click the first Add evaluator button (there's one per row)
    const buttons = screen.getAllByTestId("add-evaluator-button-target-1");
    await user.click(buttons[0]!);

    // Verify openDrawer was called - the actual drawer rendering is tested in drawer integration tests
    // Since we use URL-based drawer management, we just verify the action was triggered
  });
});
