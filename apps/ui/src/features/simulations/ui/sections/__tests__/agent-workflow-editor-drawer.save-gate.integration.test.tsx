import "@testing-library/jest-dom/vitest";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioInputMappingSectionProps } from "@langwatch/scenario-web/scenario-mappings";
import { AgentWorkflowEditorDrawer } from "../agent-workflow-drawers.tsx";

const mocks = vi.hoisted(() => ({
  agentData: null as Record<string, unknown> | null,
  workflowData: null as Record<string, unknown> | null,
}));

vi.mock("@langwatch/scenario-web/simulations", () => ({
  useScenarioHost: () => ({
    project: () => ({ id: "test-project", slug: "test-project" }),
    organization: { id: "test-org" },
    team: null,
  }),
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

vi.mock("@langwatch/scenario-web/scenario-mappings", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@langwatch/scenario-web/scenario-mappings")>();
  return {
    ...mod,
    ScenarioInputMappingSection: ({ inputs }: ScenarioInputMappingSectionProps) => (
      <div data-testid="scenario-mapping-section">
        {inputs.map((i) => (
          <div key={i.identifier} data-testid={`scenario-mapping-input-${i.identifier}`}>
            {i.identifier}
          </div>
        ))}
      </div>
    ),
  };
});

vi.mock("@langwatch/agent-web/agent-client", () => ({
  agentApi: {
    agents: {
      getById: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled === false) {
            return { data: undefined, isLoading: false, error: null };
          }
          return { data: mocks.agentData, isLoading: false, error: null };
        },
      },
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
      workflow: {
        getById: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("@langwatch/workflow-web/surfaces/workflow-api", () => ({
  api: {
    workflow: {
      getById: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled === false) {
            return { data: undefined, isLoading: false, error: null };
          }
          return { data: mocks.workflowData, isLoading: false, error: null };
        },
      },
    },
  },
}));

const DSL_WITH_OUTPUTS = {
  spec_version: "1.4" as const,
  name: "Full Workflow",
  icon: "🔧",
  description: "",
  version: "1",
  default_llm: { model: "openai/gpt-5-mini", temperature: 0 },
  template_adapter: "default" as const,
  enable_tracing: false,
  state: {},
  nodes: [
    {
      id: "entry",
      type: "entry",
      position: { x: 0, y: 0 },
      data: {
        name: "Entry",
        outputs: [{ identifier: "userMessage", type: "str" }],
      },
    },
    {
      id: "end",
      type: "end",
      position: { x: 400, y: 0 },
      data: {
        name: "End",
        inputs: [{ identifier: "response", type: "str" }],
      },
    },
  ],
  edges: [],
};

const DSL_INPUTS_NO_OUTPUTS = {
  spec_version: "1.4" as const,
  name: "Inputs-Only Workflow",
  icon: "🔧",
  description: "",
  version: "1",
  default_llm: { model: "openai/gpt-5-mini", temperature: 0 },
  template_adapter: "default" as const,
  enable_tracing: false,
  state: {},
  nodes: [
    {
      id: "entry",
      type: "entry",
      position: { x: 0, y: 0 },
      data: {
        name: "Entry",
        outputs: [{ identifier: "userMessage", type: "str" }],
      },
    },
    {
      id: "end",
      type: "end",
      position: { x: 400, y: 0 },
      data: {
        name: "End",
        inputs: [], // no workflow outputs
      },
    },
  ],
  edges: [],
};

const AGENT_INPUT_MAPPING_CLEARED_OUTPUT = {
  id: "agent-cleared-output",
  name: "Cleared Output Agent",
  type: "workflow" as const,
  projectId: "test-project",
  workflowId: "workflow-with-outputs",
  config: {
    workflow_id: "workflow-with-outputs",
    scenarioMappings: {
      userMessage: {
        type: "source" as const,
        sourceId: "scenario",
        path: ["input"],
      },
    },
    scenarioOutputField: "", // explicitly cleared by user
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  description: null,
  copiedFromAgentId: null,
};

const AGENT_INPUT_MAPPING_NO_WORKFLOW_OUTPUTS = {
  id: "agent-no-wf-outputs",
  name: "No Workflow Outputs Agent",
  type: "workflow" as const,
  projectId: "test-project",
  workflowId: "workflow-no-outputs",
  config: {
    workflow_id: "workflow-no-outputs",
    scenarioMappings: {
      userMessage: {
        type: "source" as const,
        sourceId: "scenario",
        path: ["input"],
      },
    },
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  description: null,
  copiedFromAgentId: null,
};

const AGENT_NO_INPUT_MAPPING = {
  id: "agent-no-input",
  name: "ThreadId-Only Agent",
  type: "workflow" as const,
  projectId: "test-project",
  workflowId: "workflow-with-outputs",
  config: {
    workflow_id: "workflow-with-outputs",
    scenarioMappings: {
      sessionId: {
        type: "source" as const,
        sourceId: "scenario",
        path: ["threadId"], // threadId only — not "input" or "messages"
      },
    },
    scenarioOutputField: "response",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  description: null,
  copiedFromAgentId: null,
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDrawer(agentId: string) {
  return render(<AgentWorkflowEditorDrawer open={true} agentId={agentId} />, {
    wrapper: Wrapper,
  });
}

describe("AgentWorkflowEditorDrawer save gate", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  describe("given a workflow with outputs and a valid input mapping but outputField explicitly cleared", () => {
    beforeEach(() => {
      mocks.agentData = AGENT_INPUT_MAPPING_CLEARED_OUTPUT;
      mocks.workflowData = {
        id: "workflow-with-outputs",
        name: "Full Workflow",
        projectId: "test-project",
        icon: "🔧",
        updatedAt: "2026-09-08T00:00:00Z",
        currentVersion: { id: "v1", dsl: DSL_WITH_OUTPUTS },
      };
    });

    describe("when the drawer renders with the pre-saved config", () => {
      it("enables the Save Changes button", async () => {
        renderDrawer("agent-cleared-output");

        await waitFor(() => {
          expect(screen.getByTestId("save-agent-button")).not.toBeDisabled();
        });
      });
    });
  });

  describe("given a workflow with no end outputs and a valid input mapping", () => {
    beforeEach(() => {
      mocks.agentData = AGENT_INPUT_MAPPING_NO_WORKFLOW_OUTPUTS;
      mocks.workflowData = {
        id: "workflow-no-outputs",
        name: "Inputs-Only Workflow",
        projectId: "test-project",
        icon: "🔧",
        updatedAt: "2026-09-08T00:00:00Z",
        currentVersion: { id: "v2", dsl: DSL_INPUTS_NO_OUTPUTS },
      };
    });

    describe("when the drawer renders with the pre-saved config", () => {
      it("keeps the Save Changes button disabled", async () => {
        renderDrawer("agent-no-wf-outputs");

        await waitFor(() => {
          expect(screen.getByTestId("save-agent-button")).toBeDisabled();
        });
      });
    });
  });

  describe("given a workflow with outputs but no input-field mapping", () => {
    beforeEach(() => {
      mocks.agentData = AGENT_NO_INPUT_MAPPING;
      mocks.workflowData = {
        id: "workflow-with-outputs",
        name: "Full Workflow",
        projectId: "test-project",
        icon: "🔧",
        updatedAt: "2026-09-08T00:00:00Z",
        currentVersion: { id: "v3", dsl: DSL_WITH_OUTPUTS },
      };
    });

    describe("when the drawer renders with threadId-only mapping", () => {
      it("keeps the Save Changes button disabled", async () => {
        renderDrawer("agent-no-input");

        await waitFor(() => {
          expect(screen.getByTestId("save-agent-button")).toBeDisabled();
        });
      });
    });
  });
});
