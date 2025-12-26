/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluationsV3Table } from "../components/EvaluationsV3Table";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Track which drawer was opened
let openedDrawer: string | null = null;

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

// Mock Evaluator Drawers - track which one is opened
vi.mock("~/components/evaluators/EvaluatorListDrawer", () => ({
  EvaluatorListDrawer: ({ open }: { open: boolean }) => {
    if (open) openedDrawer = "evaluatorList";
    return open ? <div data-testid="evaluator-list-drawer">Evaluator List Drawer</div> : null;
  },
}));
vi.mock("~/components/evaluators/EvaluatorCategorySelectorDrawer", () => ({
  EvaluatorCategorySelectorDrawer: ({ open }: { open: boolean }) => {
    if (open) openedDrawer = "evaluatorCategorySelector";
    return open ? <div data-testid="evaluator-category-drawer">Evaluator Category Drawer</div> : null;
  },
}));
vi.mock("~/components/evaluators/EvaluatorTypeSelectorDrawer", () => ({
  EvaluatorTypeSelectorDrawer: ({ open }: { open: boolean }) => {
    if (open) openedDrawer = "evaluatorTypeSelector";
    return open ? <div data-testid="evaluator-type-drawer">Evaluator Type Drawer</div> : null;
  },
}));
vi.mock("~/components/evaluators/EvaluatorEditorDrawer", () => ({
  EvaluatorEditorDrawer: ({ open }: { open: boolean }) => {
    if (open) openedDrawer = "evaluatorEditor";
    return open ? <div data-testid="evaluator-editor-drawer">Evaluator Editor Drawer</div> : null;
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Add Evaluator Button", () => {
  beforeEach(() => {
    openedDrawer = null;
    vi.clearAllMocks();

    // Reset store state
    const store = useEvaluationsV3Store.getState();
    store.reset();

    // Set up test data with an agent
    useEvaluationsV3Store.setState({
      agents: [
        {
          id: "agent-1",
          type: "llm",
          name: "Test Agent",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          mappings: {},
          evaluatorIds: [],
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

  it("renders Add evaluator button for each agent", async () => {
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    await waitFor(() => {
      // There should be at least one add evaluator button
      expect(screen.getAllByTestId("add-evaluator-button-agent-1").length).toBeGreaterThan(0);
    });
  });

  it("opens evaluator list drawer when Add evaluator is clicked", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getAllByTestId("add-evaluator-button-agent-1").length).toBeGreaterThan(0);
    });

    // Click the first Add evaluator button (there's one per row)
    const buttons = screen.getAllByTestId("add-evaluator-button-agent-1");
    await user.click(buttons[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("evaluator-list-drawer")).toBeInTheDocument();
    });

    expect(openedDrawer).toBe("evaluatorList");
  });
});

