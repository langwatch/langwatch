import "@testing-library/jest-dom/vitest";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Field, AgentInputBinding } from "@langwatch/agent-contract";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioInputMappingSectionProps } from "@langwatch/scenario-web/scenario-mappings";
import {
  AgentWorkflowEditorDrawer,
  AgentWorkflowTargetEditorDrawer,
} from "../agent-workflow-drawers.tsx";

const queryState = vi.hoisted(() => ({ workflowFailed: false }));

vi.mock("@langwatch/prompt-web/surfaces/variables", () => ({
  VariablesSection: (props: {
    variables: Field[];
    onMappingChange?: (identifier: string, mapping: AgentInputBinding | undefined) => void;
  }) => (
    <div data-testid="target-mappings">
      {props.variables.map((field) => (
        <span key={field.identifier}>
          {field.identifier}:{field.type}
        </span>
      ))}
      <button
        onClick={() => props.onMappingChange?.("unwired_field", { type: "value", value: "mapped" })}
      >
        Map field
      </button>
    </div>
  ),
}));

vi.mock("@langwatch/scenario-web/simulations", () => ({
  useScenarioHost: () => ({
    project: () => ({ id: "test-project", slug: "test-project" }),
    organization: { id: "test-org" },
    team: null,
  }),
}));

const mockCloseDrawer = vi.fn();
const mockGoBack = vi.fn();

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: mockGoBack,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

vi.mock("@langwatch/scenario-web/scenario-mappings", () => ({
  ScenarioInputMappingSection: ({ inputs }: ScenarioInputMappingSectionProps) => (
    <div data-testid="scenario-mapping-section">
      {inputs.map((i) => (
        <div key={i.identifier} data-testid={`scenario-mapping-input-${i.identifier}`}>
          {i.identifier}
        </div>
      ))}
    </div>
  ),
  isScenarioMappingValid: () => true,
  hasScenarioInputMapping: () => true,
}));

const UNWIRED_DSL = {
  spec_version: "1.4" as const,
  name: "Test Workflow",
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
        outputs: [{ identifier: "unwired_field", type: "str" }],
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

const MOCK_AGENT = {
  id: "agent-1",
  name: "Test Workflow Agent",
  type: "workflow" as const,
  projectId: "test-project",
  workflowId: "workflow-1",
  config: {
    workflow_id: "workflow-1",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  description: null,
  copiedFromAgentId: null,
  _count: undefined,
};

const MOCK_WORKFLOW = {
  id: "workflow-1",
  name: "Test Workflow",
  projectId: "test-project",
  icon: "🔧",
  updatedAt: "2026-09-08T00:00:00Z",
  currentVersion: {
    id: "version-1",
    dsl: UNWIRED_DSL,
  },
};

vi.mock("@langwatch/agent-web/agent-client", () => ({
  agentApi: {
    agents: {
      getById: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled === false) {
            return { data: undefined, isLoading: false, error: null };
          }
          return { data: MOCK_AGENT, isLoading: false, error: null };
        },
      },
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn().mockResolvedValue(MOCK_AGENT),
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
          return {
            data: queryState.workflowFailed ? void 0 : MOCK_WORKFLOW,
            isLoading: false,
            error: null,
          };
        },
      },
    },
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDrawer(props: Partial<Parameters<typeof AgentWorkflowEditorDrawer>[0]> = {}) {
  return render(<AgentWorkflowEditorDrawer open={true} agentId="agent-1" {...props} />, {
    wrapper: Wrapper,
  });
}

describe("AgentWorkflowEditorDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.workflowFailed = false;
  });
  afterEach(cleanup);

  describe("when the linked workflow has an unwired entry output", () => {
    it("lists the unwired field as a mappable input in the scenario-mapping section", async () => {
      renderDrawer({ agentId: "agent-1" });

      await waitFor(() => {
        expect(screen.getByTestId("scenario-mapping-input-unwired_field")).toBeInTheDocument();
      });
    });
  });

  it("preserves the linked workflow navigation and forwards target mapping changes", () => {
    const onInputMappingsChange =
      vi.fn<(identifier: string, mapping: AgentInputBinding | undefined) => void>();
    render(
      <AgentWorkflowTargetEditorDrawer
        open={true}
        agentId="agent-1"
        onInputMappingsChange={onInputMappingsChange}
      />,
      { wrapper: Wrapper },
    );

    const link = screen.getByTestId("open-workflow-link");
    expect(link).toHaveAttribute("href", "/test-project/studio/workflow-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("unwired_field:str")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Map field" }));
    expect(onInputMappingsChange).toHaveBeenCalledWith("unwired_field", {
      type: "value",
      value: "mapped",
    });
  });

  it("blocks target mappings when the linked workflow cannot be read", () => {
    queryState.workflowFailed = true;
    render(<AgentWorkflowTargetEditorDrawer open={true} agentId="agent-1" />, { wrapper: Wrapper });

    expect(screen.getByTestId("workflow-lookup-error")).toBeVisible();
    expect(screen.queryByTestId("target-mappings")).not.toBeInTheDocument();
  });
});
