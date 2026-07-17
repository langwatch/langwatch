/**
 * @vitest-environment jsdom
 *
 * Integration test for: editing an existing comparison column survives a
 * page reload without duplicating the column.
 *
 * Scenario: Reloading the page while the comparison evaluator editor is open
 * for an EXISTING column (deep-linked via evaluatorId) must resume editing
 * that same target in place. Regression coverage for the bug where the
 * reload-rehydration effect always wired the add-flow's onSave/onSelect
 * callbacks, so saving after a reload created a brand new target column
 * instead of updating the one already there.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, waitFor } from "@testing-library/react";
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
vi.mock("../hooks/useTargetName", () => {
  const useTargetName = (target: { id: string }) =>
    target.id === "target-1" ? "Variant A" : "Variant B";
  return {
    useTargetName,
    useTargetNames: (targets: ({ id: string } | undefined)[]) =>
      targets.map((target) => (target ? useTargetName(target) : "")),
  };
});
vi.mock("../hooks/useEvaluatorName", () => ({
  useEvaluatorName: () => "My Comparison",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

import { COMPARISON_EVALUATOR_TYPE } from "../types";
import { EvaluationsV3Table } from "../components/EvaluationsV3Table";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Track drawer state — deep-linked into the evaluatorEditor drawer for an
// EXISTING evaluator, the way a page reload would restore the URL.
let currentDrawer: string | null = "evaluatorEditor";
let drawerProps: Record<string, unknown> = {
  evaluatorType: COMPARISON_EVALUATOR_TYPE,
  evaluatorId: "existing-comparison-eval",
};

const flowCallbacksStore: Record<string, Record<string, unknown>> = {};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: currentDrawer
      ? { "drawer.open": currentDrawer, ...drawerProps }
      : {},
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

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
    currentDrawer,
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => drawerProps,
  getComplexProps: () => drawerProps,
  setComplexProps: vi.fn(),
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

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      agents: { getById: { fetch: vi.fn() } },
      prompts: { getByIdOrHandle: { fetch: vi.fn().mockResolvedValue(null) } },
      evaluators: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn(), fetch: vi.fn() },
      },
    }),
    datasetRecord: {
      getAll: { useQuery: () => ({ data: null, isLoading: false }) },
      update: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteMany: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    agents: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    evaluators: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
      getById: { useQuery: () => ({ data: null, isLoading: false }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("~/components/AddOrEditDatasetDrawer", () => ({
  AddOrEditDatasetDrawer: () => null,
}));
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

describe("Reopening the comparison editor after a reload", () => {
  beforeEach(() => {
    currentDrawer = "evaluatorEditor";
    drawerProps = {
      evaluatorType: COMPARISON_EVALUATOR_TYPE,
      evaluatorId: "existing-comparison-eval",
    };
    Object.keys(flowCallbacksStore).forEach(
      (key) => delete flowCallbacksStore[key],
    );
    vi.clearAllMocks();

    const store = useEvaluationsV3Store.getState();
    store.reset();

    useEvaluationsV3Store.setState({
      experimentId: "exp-1",
      targets: [
        {
          id: "target-1",
          type: "prompt",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          mappings: {},
        },
        {
          id: "target-2",
          type: "prompt",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          mappings: {},
        },
        {
          id: "comparison-target-1",
          type: "evaluator",
          targetEvaluatorId: "existing-comparison-eval",
          inputs: [],
          outputs: [],
          mappings: {},
          comparison: {
            variants: ["target-1", "target-2"],
            hasGoldenAnswer: false,
            goldenField: "",
            includeMetrics: [],
            randomizeOrder: true,
          },
        },
      ],
      datasets: [
        {
          id: "test-data",
          name: "Test Data",
          type: "inline",
          columns: [{ id: "input", name: "input", type: "string" }],
          inline: {
            columns: [{ id: "input", name: "input", type: "string" }],
            records: { input: ["test value"] },
          },
        },
      ],
      activeDatasetId: "test-data",
      evaluators: [],
    });
  });

  afterEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  it("wires the reopened editor to update the existing target, not create one", async () => {
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(flowCallbacksStore.evaluatorEditor).toBeDefined();
    });

    const callbacks = flowCallbacksStore.evaluatorEditor as {
      onSave?: unknown;
      onComparisonChange?: (config: unknown) => void;
    };

    // The add-flow's onSave (which always creates a fresh target) must not be
    // wired when we resumed editing an existing target.
    expect(callbacks.onSave).toBeUndefined();
    expect(callbacks.onComparisonChange).toEqual(expect.any(Function));

    const updatedComparison = {
      variants: ["target-1", "target-2"],
      hasGoldenAnswer: true,
      goldenField: "expected_output",
      includeMetrics: [],
      randomizeOrder: true,
    };
    callbacks.onComparisonChange?.(updatedComparison);

    const targets = useEvaluationsV3Store.getState().targets;
    expect(targets).toHaveLength(3);
    const comparisonTarget = targets.find((t) => t.id === "comparison-target-1");
    expect(comparisonTarget?.comparison).toEqual(updatedComparison);
  });

  it("stays at one comparison column across repeated saves after reopening", async () => {
    render(<EvaluationsV3Table disableVirtualization />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(flowCallbacksStore.evaluatorEditor).toBeDefined();
    });

    const callbacks = flowCallbacksStore.evaluatorEditor as {
      onComparisonChange?: (config: unknown) => void;
    };
    const save = () =>
      callbacks.onComparisonChange?.({
        variants: ["target-1", "target-2"],
        hasGoldenAnswer: false,
        goldenField: "",
        includeMetrics: [],
        randomizeOrder: true,
      });

    // Two edits in the same reopened session — neither should add a target.
    save();
    save();

    const comparisonTargets = useEvaluationsV3Store
      .getState()
      .targets.filter((t) => t.type === "evaluator");
    expect(comparisonTargets).toHaveLength(1);
    expect(comparisonTargets[0]?.id).toBe("comparison-target-1");
  });
});
