/**
 * @vitest-environment jsdom
 *
 * Integration test for: Newly created evaluator is automatically added to workbench
 *
 * Scenario: Newly created evaluator is automatically added to workbench
 *   When I click "+ Add evaluator" inside the "GPT-4o" agent cell
 *   And I click "New Evaluator"
 *   And I select category "Expected Answer"
 *   And I select evaluator type "Exact Match"
 *   And I configure the evaluator name as "My Custom Evaluator"
 *   And I click "Create Evaluator"
 *   Then the drawer closes
 *   And the evaluator "My Custom Evaluator" is added to the workbench
 *   And the evaluator chip appears inside the agent cell
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Mock name hooks to avoid tRPC queries
vi.mock("../hooks/useTargetName", () => ({
  useTargetName: () => "My Prompt",
}));
vi.mock("../hooks/useEvaluatorName", () => ({
  useEvaluatorName: () => "My Custom Evaluator",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

import { EvaluationsV3Table } from "../components/EvaluationsV3Table";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Track drawer state
let currentDrawer: string | null = null;
let drawerProps: Record<string, unknown> = {};

// Create a mock for setFlowCallbacks that actually stores callbacks
const flowCallbacksStore: Record<string, Record<string, unknown>> = {};

// Mock next/router
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: currentDrawer
      ? { "drawer.open": currentDrawer, ...drawerProps }
      : {},
    push: vi.fn((url: string) => {
      // Parse drawer from URL
      if (url.includes("drawer.open")) {
        const match = url.match(/drawer\.open=([^&]+)/);
        currentDrawer = match?.[1] ?? null;
      } else {
        currentDrawer = null;
      }
    }),
    replace: vi.fn(),
  }),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn((drawer: string, props?: Record<string, unknown>) => {
      currentDrawer = drawer;
      drawerProps = props ?? {};
    }),
    closeDrawer: vi.fn(() => {
      currentDrawer = null;
      drawerProps = {};
    }),
    drawerOpen: (drawer: string) => currentDrawer === drawer,
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => drawerProps,
  getComplexProps: () => drawerProps,
  setFlowCallbacks: vi.fn(
    (drawer: string, callbacks: Record<string, unknown>) => {
      flowCallbacksStore[drawer] = callbacks;
    },
  ),
  getFlowCallbacks: vi.fn((drawer: string) => flowCallbacksStore[drawer]),
  clearFlowCallbacks: vi.fn(() => {
    Object.keys(flowCallbacksStore).forEach(
      (key) => delete flowCallbacksStore[key],
    );
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
        getAll: {
          invalidate: vi.fn(),
        },
        getById: {
          invalidate: vi.fn(),
          fetch: vi.fn().mockResolvedValue({
            id: "new-evaluator-123",
            name: "My Custom Evaluator",
            type: "evaluator",
            projectId: "test-project",
            config: {
              evaluatorType: "langevals/exact_match",
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            fields: [
              { identifier: "output", type: "str" },
              { identifier: "expected_output", type: "str" },
            ],
          }),
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
      getById: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
      create: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
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
vi.mock("~/components/prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));

// Mock Evaluator Drawers - but render them to test the flow
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

describe("New Evaluator Added to Workbench", () => {
  beforeEach(() => {
    currentDrawer = null;
    drawerProps = {};
    Object.keys(flowCallbacksStore).forEach(
      (key) => delete flowCallbacksStore[key],
    );
    vi.clearAllMocks();

    // Reset store state
    const store = useEvaluationsV3Store.getState();
    store.reset();

    // Set up test data with a target (agent)
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
          columns: [
            { id: "input", name: "input", type: "string" },
            { id: "expected_output", name: "expected_output", type: "string" },
          ],
          inline: {
            columns: [
              { id: "input", name: "input", type: "string" },
              {
                id: "expected_output",
                name: "expected_output",
                type: "string",
              },
            ],
            records: {
              input: ["test value"],
              expected_output: ["expected value"],
            },
          },
        },
      ],
      activeDatasetId: "test-data",
      evaluators: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("sets up onSave callback for evaluatorEditor when clicking Add evaluator", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    // Wait for the table to render with the target
    await waitFor(() => {
      expect(
        screen.getAllByTestId("add-evaluator-button-target-1").length,
      ).toBeGreaterThan(0);
    });

    // Click the Add evaluator button
    const buttons = screen.getAllByTestId("add-evaluator-button-target-1");
    await user.click(buttons[0]!);

    // Verify that setFlowCallbacks was called for evaluatorList with onSelect
    const { setFlowCallbacks: mockSetFlowCallbacks } = await import(
      "~/hooks/useDrawer"
    );
    expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
      "evaluatorList",
      expect.objectContaining({
        onSelect: expect.any(Function),
      }),
    );

    // The key assertion: setFlowCallbacks should ALSO be called for evaluatorEditor with onSave
    // This is what we need to implement!
    expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
      "evaluatorEditor",
      expect.objectContaining({
        onSave: expect.any(Function),
      }),
    );
  });

  it("adds newly created evaluator to workbench when onSave is called", async () => {
    const user = userEvent.setup();
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    // Wait for the table to render
    await waitFor(() => {
      expect(
        screen.getAllByTestId("add-evaluator-button-target-1").length,
      ).toBeGreaterThan(0);
    });

    // Click the Add evaluator button to set up flow callbacks
    const buttons = screen.getAllByTestId("add-evaluator-button-target-1");
    await user.click(buttons[0]!);

    // Get the onSave callback that was registered for evaluatorEditor
    const evaluatorEditorCallbacks = flowCallbacksStore.evaluatorEditor as
      | {
          onSave?: (evaluator: { id: string; name: string }) => Promise<void>;
        }
      | undefined;

    // Simulate what happens when a new evaluator is created and saved
    // The EvaluatorEditorDrawer calls onSave with the new evaluator's id and name
    // The callback is async so we need to await it
    await act(async () => {
      await evaluatorEditorCallbacks?.onSave?.({
        id: "new-evaluator-123",
        name: "My Custom Evaluator",
      });
    });

    // Verify the evaluator was added to the workbench store
    const state = useEvaluationsV3Store.getState();
    expect(state.evaluators.length).toBe(1);
    expect(state.evaluators[0]?.dbEvaluatorId).toBe("new-evaluator-123");
  });

  it("evaluator chip appears in the table after new evaluator is added", async () => {
    // First, manually add an evaluator to the store (simulating what onSave should do)
    useEvaluationsV3Store.setState({
      evaluators: [
        {
          id: "evaluator_123",
          evaluatorType: "langevals/exact_match",
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          mappings: {},
          dbEvaluatorId: "new-evaluator-123",
        },
      ],
    });

    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    // The evaluator chip should appear in the table (one per row)
    await waitFor(() => {
      const chips = screen.getAllByText("My Custom Evaluator");
      expect(chips.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Auto-open the evaluator mapping drawer when required fields stay unmapped
// ============================================================================

describe("Adding an evaluator with unmapped required fields", () => {
  // A prompt target whose single output is "output".
  const promptTarget = {
    id: "target-1",
    type: "prompt" as const,
    inputs: [{ identifier: "input", type: "str" as const }],
    outputs: [{ identifier: "output", type: "str" as const }],
    mappings: {},
  };

  const makeColumn = (name: string) => ({
    id: name,
    name,
    type: "string" as const,
  });
  const makeDataset = (columnNames: string[]) => ({
    id: "test-data",
    name: "Test Data",
    type: "inline" as const,
    columns: columnNames.map(makeColumn),
    inline: {
      columns: columnNames.map(makeColumn),
      // One row so the table renders a target cell (the add-evaluator button
      // lives inside the per-row cell).
      records: Object.fromEntries(
        columnNames.map((name) => [name, ["sample"]]),
      ),
    },
  });

  // An existing library evaluator selected from the picker (the onSelect path).
  const makeSelectedEvaluator = (
    fields: Array<{ identifier: string; type: string }>,
  ) =>
    ({
      id: "library-evaluator-1",
      name: "My Custom Evaluator",
      type: "evaluator",
      projectId: "test-project",
      config: { evaluatorType: "langevals/exact_match" },
      createdAt: new Date(),
      updatedAt: new Date(),
      fields,
    }) as never;

  const seedWorkbench = (columnNames: string[]) => {
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.setState({
      targets: [promptTarget],
      datasets: [makeDataset(columnNames)],
      activeDatasetId: "test-data",
      evaluators: [],
    });
  };

  const addEvaluatorViaPicker = async (
    user: ReturnType<typeof userEvent.setup>,
    fields: Array<{ identifier: string; type: string }>,
  ) => {
    const buttons = screen.getAllByTestId("add-evaluator-button-target-1");
    await user.click(buttons[0]!);

    const onSelect = flowCallbacksStore.evaluatorList?.onSelect as
      | ((evaluator: unknown) => void)
      | undefined;
    await act(async () => {
      onSelect?.(makeSelectedEvaluator(fields));
    });
  };

  beforeEach(() => {
    currentDrawer = null;
    drawerProps = {};
    Object.keys(flowCallbacksStore).forEach(
      (key) => delete flowCallbacksStore[key],
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  /** @scenario Adding an evaluator with unmapped required fields opens its mapping drawer */
  it("opens the evaluator mapping drawer when a required field cannot be auto-mapped", async () => {
    const user = userEvent.setup();
    // The evaluator needs "ground_truth", which is an expected-answer field the
    // dataset does not carry (and is never sourced from the target output), so
    // it cannot be auto-mapped.
    seedWorkbench(["input"]);
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(
        screen.getAllByTestId("add-evaluator-button-target-1").length,
      ).toBeGreaterThan(0);
    });

    await addEvaluatorViaPicker(user, [
      { identifier: "ground_truth", type: "str" },
    ]);

    // The evaluator was added, and instead of silently closing the picker the
    // mapping drawer opened onto the unmapped fields.
    expect(useEvaluationsV3Store.getState().evaluators.length).toBe(1);
    expect(currentDrawer).toBe("evaluatorEditor");
    expect(drawerProps.evaluatorId).toBe("library-evaluator-1");
  });

  /** @scenario Adding an evaluator whose required fields all auto-map closes the picker */
  it("closes the picker when every required field auto-maps", async () => {
    const user = userEvent.setup();
    // Dataset carries "expected_output", so both required fields auto-map
    // (output -> target output, expected_output -> dataset column).
    seedWorkbench(["input", "expected_output"]);
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(
        screen.getAllByTestId("add-evaluator-button-target-1").length,
      ).toBeGreaterThan(0);
    });

    await addEvaluatorViaPicker(user, [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ]);

    expect(useEvaluationsV3Store.getState().evaluators.length).toBe(1);
    expect(currentDrawer).toBeNull();
  });

  /** @scenario The evaluator mapping selector offers target outputs before dataset columns */
  it("lists the target outputs before the dataset columns in the opened drawer", async () => {
    const user = userEvent.setup();
    seedWorkbench(["input"]);
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(
        screen.getAllByTestId("add-evaluator-button-target-1").length,
      ).toBeGreaterThan(0);
    });

    await addEvaluatorViaPicker(user, [
      { identifier: "ground_truth", type: "str" },
    ]);

    expect(currentDrawer).toBe("evaluatorEditor");
    const mappingsConfig = drawerProps.mappingsConfig as {
      availableSources: Array<{ id: string; type: string }>;
    };
    // Target signature source comes first, dataset second.
    expect(mappingsConfig.availableSources[0]?.type).toBe("signature");
    expect(mappingsConfig.availableSources[0]?.id).toBe("target-1");
    expect(mappingsConfig.availableSources[1]?.type).toBe("dataset");
  });
});
