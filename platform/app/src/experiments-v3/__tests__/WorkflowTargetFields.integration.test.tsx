/**
 * @vitest-environment jsdom
 *
 * A workflow agent target's fields live on its Studio workflow, not on the
 * agent, so the workbench reconciles them from the API on load. Before that,
 * a workflow producing "output" and "chunks" reached the evaluator's variable
 * picker as a single invented field called "output".
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

import type { AvailableSource } from "~/components/variables";
import { EvaluationsV3Table } from "../components/EvaluationsV3Table";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { DatasetReference, EvaluatorConfig, TargetConfig } from "../types";

let openedDrawerType: string | null = null;
let openedDrawerParams: Record<string, any> = {};

// What agents.getAll reports for this project, i.e. the fields the API derived
// from each agent's linked workflow.
const agentsOnServer = {
  data: [] as Array<Record<string, unknown>>,
};

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn((type: string, params: Record<string, unknown>) => {
      openedDrawerType = type;
      openedDrawerParams = params ?? {};
    }),
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
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
  const useTargetName = (_target: { id: string }) => "wf agent";
  return {
    useTargetName,
    useTargetNames: (targets: ({ id: string } | undefined)[]) =>
      targets.map((target) => (target ? useTargetName(target) : "")),
  };
});
vi.mock("../hooks/useEvaluatorName", () => ({
  useEvaluatorName: () => "Exact Match",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      agents: { getById: { fetch: vi.fn() } },
      prompts: { getByIdOrHandle: { fetch: vi.fn().mockResolvedValue(null) } },
      evaluators: { getById: { fetch: vi.fn().mockResolvedValue(null) } },
    }),
    datasetRecord: {
      getAll: { useQuery: () => ({ data: null, isLoading: false }) },
      update: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteMany: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    agents: {
      getAll: {
        useQuery: () => ({ data: agentsOnServer.data, isLoading: false }),
      },
    },
    evaluators: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    prompts: {
      getAllPromptsForProject: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
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

const workflowTarget = (overrides?: Partial<TargetConfig>): TargetConfig => ({
  id: "target-1",
  type: "agent",
  agentType: "workflow",
  dbAgentId: "agent-1",
  // What the workbench recorded when the column was added: the synthetic
  // single field, because nothing read the workflow.
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
  ...overrides,
});

const dataset = (): DatasetReference => ({
  id: "test-data",
  name: "Test Data",
  type: "inline",
  columns: [
    { id: "question", name: "question", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
  inline: {
    columns: [
      { id: "question", name: "question", type: "string" },
      { id: "expected_output", name: "expected_output", type: "string" },
    ],
    records: { question: ["is a dog an animal?"], expected_output: ["yes"] },
  },
});

const evaluator = (): EvaluatorConfig => ({
  id: "evaluator-1",
  evaluatorType: "langevals/exact_match",
  dbEvaluatorId: "db-eval-1",
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  mappings: {},
});

const seed = (target: TargetConfig) => {
  useEvaluationsV3Store.setState({
    targets: [target],
    datasets: [dataset()],
    activeDatasetId: "test-data",
    evaluators: [evaluator()],
  });
};

const targetInStore = () =>
  useEvaluationsV3Store.getState().targets.find((t) => t.id === "target-1");

describe("Workflow agent target fields", () => {
  beforeEach(() => {
    openedDrawerType = null;
    openedDrawerParams = {};
    agentsOnServer.data = [
      {
        id: "agent-1",
        name: "wf agent",
        type: "workflow",
        config: { name: "wf agent", isCustom: true, workflow_id: "wf_1" },
        inputFields: [{ identifier: "question", type: "str" }],
        outputFields: [
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ],
        fieldsResolved: true,
      },
    ];
    vi.clearAllMocks();
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a saved workbench whose target records only one output", () => {
    describe("when the workbench loads", () => {
      /** @scenario "A target added before the fields were derived recovers on load" */
      it("records every result the workflow declares", async () => {
        seed(workflowTarget());
        render(<EvaluationsV3Table disableVirtualization />, {
          wrapper: Wrapper,
        });

        await waitFor(() => {
          expect(targetInStore()?.outputs).toEqual([
            { identifier: "output", type: "str" },
            { identifier: "chunks", type: "dict" },
          ]);
        });
      });

      it("records the workflow's own inputs rather than a synthetic one", async () => {
        seed(workflowTarget());
        render(<EvaluationsV3Table disableVirtualization />, {
          wrapper: Wrapper,
        });

        await waitFor(() => {
          expect(targetInStore()?.inputs).toEqual([
            { identifier: "question", type: "str" },
          ]);
        });
      });

      it("does not record the reconciliation as an undoable edit", async () => {
        seed(workflowTarget());
        useEvaluationsV3Store.temporal.getState().clear();

        render(<EvaluationsV3Table disableVirtualization />, {
          wrapper: Wrapper,
        });

        await waitFor(() => {
          expect(targetInStore()?.outputs).toHaveLength(2);
        });
        expect(
          useEvaluationsV3Store.temporal.getState().pastStates,
        ).toHaveLength(0);
      });
    });

    describe("when an evaluator is opened against that target", () => {
      /** @scenario "Adding a workflow agent as a target offers every result to an evaluator" */
      it("offers every result as a mapping source, with its own type", async () => {
        const user = userEvent.setup();
        seed(workflowTarget());
        render(<EvaluationsV3Table disableVirtualization />, {
          wrapper: Wrapper,
        });

        await waitFor(() => {
          expect(targetInStore()?.outputs).toHaveLength(2);
        });
        await waitFor(() => {
          expect(screen.getAllByText("Exact Match").length).toBeGreaterThan(0);
        });

        await user.click(screen.getAllByText("Exact Match")[0]!);
        await waitFor(() => {
          expect(screen.getByText("Edit Configuration")).toBeInTheDocument();
        });
        await user.click(screen.getByText("Edit Configuration"));

        expect(openedDrawerType).toBe("evaluatorEditor");
        const sources = openedDrawerParams.mappingsConfig
          ?.availableSources as AvailableSource[];
        expect(sources[0]?.name).toBe("wf agent");
        expect(sources[0]?.fields).toEqual([
          { name: "output", type: "str" },
          { name: "chunks", type: "dict" },
        ]);
      });
    });
  });

  describe("given the linked workflow cannot be read", () => {
    describe("when the workbench loads", () => {
      /** @scenario "A target does not lose its recorded fields when the workflow cannot be read" */
      it("keeps the fields the target already recorded", async () => {
        agentsOnServer.data = [
          {
            id: "agent-1",
            name: "wf agent",
            type: "workflow",
            config: { name: "wf agent", isCustom: true, workflow_id: "wf_1" },
            inputFields: [],
            outputFields: [],
            fieldsResolved: false,
          },
        ];
        seed(
          workflowTarget({
            outputs: [
              { identifier: "output", type: "str" },
              { identifier: "chunks", type: "dict" },
            ],
          }),
        );

        render(<EvaluationsV3Table disableVirtualization />, {
          wrapper: Wrapper,
        });

        await waitFor(() => {
          expect(screen.getAllByText("wf agent").length).toBeGreaterThan(0);
        });
        expect(targetInStore()?.outputs).toEqual([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);
      });
    });
  });

  describe("given the workflow no longer declares any result", () => {
    describe("when the workbench loads", () => {
      /** @scenario "A target drops a result its workflow no longer declares" */
      it("drops the results the target still recorded", async () => {
        agentsOnServer.data = [
          {
            id: "agent-1",
            name: "wf agent",
            type: "workflow",
            config: { name: "wf agent", isCustom: true, workflow_id: "wf_1" },
            inputFields: [{ identifier: "question", type: "str" }],
            outputFields: [],
            fieldsResolved: true,
          },
        ];
        seed(
          workflowTarget({
            outputs: [
              { identifier: "output", type: "str" },
              { identifier: "chunks", type: "dict" },
            ],
          }),
        );

        render(<EvaluationsV3Table disableVirtualization />, {
          wrapper: Wrapper,
        });

        await waitFor(() => {
          expect(targetInStore()?.outputs).toEqual([]);
        });
      });

      /** @scenario "A target drops a result its workflow no longer declares" */
      it("stops offering the removed result to an evaluator", async () => {
        const user = userEvent.setup();
        agentsOnServer.data = [
          {
            id: "agent-1",
            name: "wf agent",
            type: "workflow",
            config: { name: "wf agent", isCustom: true, workflow_id: "wf_1" },
            inputFields: [{ identifier: "question", type: "str" }],
            outputFields: [],
            fieldsResolved: true,
          },
        ];
        seed(
          workflowTarget({ outputs: [{ identifier: "output", type: "str" }] }),
        );

        render(<EvaluationsV3Table disableVirtualization />, {
          wrapper: Wrapper,
        });

        await waitFor(() => {
          expect(targetInStore()?.outputs).toEqual([]);
        });
        await waitFor(() => {
          expect(screen.getAllByText("Exact Match").length).toBeGreaterThan(0);
        });

        await user.click(screen.getAllByText("Exact Match")[0]!);
        await waitFor(() => {
          expect(screen.getByText("Edit Configuration")).toBeInTheDocument();
        });
        await user.click(screen.getByText("Edit Configuration"));

        const sources = openedDrawerParams.mappingsConfig
          ?.availableSources as AvailableSource[];
        expect(sources[0]?.fields).toEqual([]);
      });
    });
  });
});
