/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the comparison column's wider default (24% vs the
 * ordinary 20% target default) being honored by the table's total-width
 * calculation, not just by the per-column render path. Before this fix,
 * `totalColumnPercentage` summed every target column — comparison or not —
 * at the plain TARGET_COL_DEFAULT_PCT, undercounting the table's real width
 * whenever a comparison column had no explicit stored size yet.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));

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

import { EvaluationsV3Table } from "../components/EvaluationsV3Table";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), replace: vi.fn() }),
}));

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
    currentDrawer: null,
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setComplexProps: vi.fn(),
  setFlowCallbacks: vi.fn(),
  getFlowCallbacks: vi.fn(),
  clearFlowCallbacks: vi.fn(),
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
    prompts: {
      getByIdOrHandle: { useQuery: () => ({ data: null, isLoading: false }) },
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

describe("given a comparison column with no explicit stored width", () => {
  beforeEach(() => {
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
          targetEvaluatorId: "eval-1",
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
      ui: {
        ...useEvaluationsV3Store.getState().ui,
        columnWidths: {},
      },
    });
  });

  afterEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  describe("when calculating the table width", () => {
    it("counts the comparison column at its own wider default", async () => {
      render(<EvaluationsV3Table disableVirtualization />, {
        wrapper: Wrapper,
      });

      // The table's overall width is set via a Chakra `css` prop, which Emotion
      // compiles into an injected <style> rule rather than an inline attribute
      // on the <table> itself — so the total is read from that stylesheet text.
      // dataset "input" (16%) + target-1 (20%) + target-2 (20%) +
      // comparison-target-1 (24%, NOT the plain 20% target default) = 80%.
      await waitFor(() => {
        const styleText = Array.from(document.head.querySelectorAll("style"))
          .map((style) => style.textContent ?? "")
          .join("\n");
        expect(styleText).toContain("max(100%, 80%)");
      });
    });
  });
});
