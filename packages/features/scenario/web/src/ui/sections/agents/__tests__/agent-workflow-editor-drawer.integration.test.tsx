/**
 * Integration test for AgentWorkflowEditorDrawer — specifically the bug where an entry node output with no downstream edge is silently dropped from the scenario-mapping section.
 * @vitest-environment jsdom
 * @see specs/features/scenarios/workflow-agent-mapping-unwired-fields.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioInputMappingSectionProps } from "../../../elements/suites/scenario-input-mapping-section";
import { AgentWorkflowEditorDrawer } from "../agent-workflow-editor-drawer";

// ---------------------------------------------------------------------------
// Dependency mocks — mirror agent-editor-test-panel.integration.test.tsx
// ---------------------------------------------------------------------------

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
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

// ---------------------------------------------------------------------------
// ScenarioInputMappingSection mock

vi.mock("../../../elements/suites/scenario-input-mapping-section", () => ({
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

// --------------------------------------------------------------------------- tRPC
// mocks

/** A minimal workflow DSL that has an entry node with one declared output
 *  ("unwired_field") but NO edges — this is the bug trigger. */
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
  // No edges — the entry output is not wired to anything. This is the bug trigger.
  edges: [],
};

/** Mock agent that points to the test workflow. */
const MOCK_AGENT = {
  id: "agent-1",
  name: "Test Workflow Agent",
  type: "workflow" as const,
  projectId: "test-project",
  workflowId: "workflow-1",
  config: {
    workflow_id: "workflow-1",
    // No saved scenarioMappings — drawer must compute them from workflow inputs.
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  description: null,
  copiedFromAgentId: null,
  _count: undefined,
};

/** Mock workflow returned by workflowApi.workflow.getById. */
const MOCK_WORKFLOW = {
  id: "workflow-1",
  name: "Test Workflow",
  projectId: "test-project",
  currentVersion: {
    id: "version-1",
    dsl: UNWIRED_DSL,
  },
};

vi.mock("../../../../behavior/scenario-api", () => ({
  api: {
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

vi.mock("@langwatch/workflow-web/utils/workflow-api", () => ({
  workflowApi: {
    workflow: {
      getById: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled === false) {
            return { data: undefined, isLoading: false, error: null };
          }
          return { data: MOCK_WORKFLOW, isLoading: false, error: null };
        },
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDrawer(props: Partial<Parameters<typeof AgentWorkflowEditorDrawer>[0]> = {}) {
  return render(<AgentWorkflowEditorDrawer open={true} agentId="agent-1" {...props} />, {
    wrapper: Wrapper,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentWorkflowEditorDrawer", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  describe("when the linked workflow has an unwired entry output", () => {
    /** @scenario "Edit Workflow Agent drawer lists an unwired entry field as a mappable input" */
    it("lists the unwired field as a mappable input in the scenario-mapping section", async () => {
      renderDrawer({ agentId: "agent-1" });

      // The mocked ScenarioInputMappingSection renders each item in its `inputs` prop
      // as a visible div with the identifier text.
      await waitFor(() => {
        expect(screen.getByTestId("scenario-mapping-input-unwired_field")).toBeInTheDocument();
      });
    });
  });
});
