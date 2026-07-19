/**
 * @vitest-environment jsdom
 *
 * Integration test for AgentWorkflowEditorDrawer — specifically the bug where
 * an entry node output with no downstream edge is silently dropped from the
 * scenario-mapping section.
 *
 * Bug path:
 *   getInputsOutputs(edges, nodes) → derives inputs from edges only →
 *   if entry has outputs but no edges, inputs = [] →
 *   drawer falls back to synthetic [{identifier:"input"}] →
 *   ScenarioInputMappingSection receives no "unwired_field" input
 *
 * Fix will make getInputsOutputs seed inputs from entryNode.data.outputs
 * when no edge covers them.
 *
 * @see specs/scenarios/workflow-agent-mapping.feature
 */

import type React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkflowEditorDrawer } from "../AgentWorkflowEditorDrawer";
import type { ScenarioInputMappingSectionProps } from "~/components/suites/ScenarioInputMappingSection";

// ---------------------------------------------------------------------------
// Dependency mocks — mirror AgentCodeEditorDrawer.integration.test.tsx
// ---------------------------------------------------------------------------

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: { project: "test-project" },
    asPath: "/test",
  }),
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "test-user" } },
    status: "authenticated",
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
    organization: { id: "test-org" },
    team: null,
  }),
}));

vi.mock("~/hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (callback: () => void) => callback(),
    isLoading: false,
    isAllowed: true,
    limitInfo: { allowed: true, current: 0, max: 10 },
  }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// ---------------------------------------------------------------------------
// Drawer hooks
// ---------------------------------------------------------------------------

const mockCloseDrawer = vi.fn();
const mockGoBack = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
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
//
// The real section renders SCENARIO_FIELDS (input/messages/threadId) as rows
// and places workflow inputs in an "Agent Inputs" dropdown — not as visible
// row labels.  That makes direct assertion on "unwired_field" impossible
// without user interaction.
//
// We mock the section to render each `inputs` prop identifier as a visible
// <div>, making the contract clear: "the drawer must pass unwired_field to
// the section."  When the bug is present, workflowInputs is [] and the
// drawer substitutes the fallback [{identifier:"input"}] — so unwired_field
// never appears.  When the bug is fixed, workflowInputs is
// [{identifier:"unwired_field"}] and it IS passed and rendered.
// ---------------------------------------------------------------------------

vi.mock("~/components/suites/ScenarioInputMappingSection", () => ({
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

// ---------------------------------------------------------------------------
// tRPC mock
//
// The drawer calls:
//   api.agents.getById.useQuery   — load agent (with workflowId + config)
//   api.workflow.getById.useQuery — load workflow (with currentVersion.dsl)
//   api.agents.update.useMutation — save (not exercised here)
//   api.useContext()              — for cache invalidation after save
// ---------------------------------------------------------------------------

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

/** Mock workflow returned by api.workflow.getById. */
const MOCK_WORKFLOW = {
  id: "workflow-1",
  name: "Test Workflow",
  projectId: "test-project",
  currentVersion: {
    id: "version-1",
    dsl: UNWIRED_DSL,
  },
};

vi.mock("~/utils/api", () => ({
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
    useContext: () => ({
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDrawer(
  props: Partial<Parameters<typeof AgentWorkflowEditorDrawer>[0]> = {},
) {
  return render(
    <AgentWorkflowEditorDrawer open={true} agentId="agent-1" {...props} />,
    { wrapper: Wrapper },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentWorkflowEditorDrawer", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  describe("when the linked workflow has an unwired entry output", () => {
    /** @scenario Edit Workflow Agent drawer lists an unwired entry field as a mappable input */
    it("lists the unwired field as a mappable input in the scenario-mapping section", async () => {
      renderDrawer({ agentId: "agent-1" });

      // The mocked ScenarioInputMappingSection renders each item in its `inputs`
      // prop as a visible div with the identifier text.
      //
      // BUG (failing): getInputsOutputs reads only edges — since there are none,
      // workflowInputs is [], the drawer falls back to [{identifier:"input"}],
      // and ScenarioInputMappingSection never receives "unwired_field".
      //
      // FIXED: getInputsOutputs also reads entryNode.data.outputs when no edge
      // covers an output, so workflowInputs = [{identifier:"unwired_field"}],
      // and the section receives and renders it.
      await waitFor(() => {
        expect(screen.getByTestId("scenario-mapping-input-unwired_field")).toBeInTheDocument();
      });
    });
  });
});
