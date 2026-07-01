/**
 * @vitest-environment jsdom
 *
 * Integration tests for AgentWorkflowEditorDrawer Save gate — Issue #3412
 *
 * The ONLY source change is in isScenarioMappingValid: the `&& hasOutputMapping`
 * conjunction is dropped so the function returns true whenever a valid input
 * mapping is present, regardless of whether an output mapping has been selected.
 *
 * The structural guards `workflowInputs.length > 0` and
 * `workflowOutputs.length > 0` in AgentWorkflowEditorDrawer.tsx:215-223 STAY.
 * `workflowOutputs` derives from the published workflow's end-node inputs
 * (extractVariables). Length === 0 means the workflow structurally emits
 * nothing; enabling Save there would start a run judged on "{}". That gate is
 * load-bearing and must remain.
 *
 * Test matrix:
 *   (a) RED→GREEN  — workflow WITH end outputs + input mapping + outputField
 *                    explicitly cleared ("") → Save ENABLED after fix
 *   (b) REGRESSION — workflow WITHOUT end outputs + input mapping → Save stays
 *                    DISABLED (structural guard must not be relaxed)
 *   (c) FAIL-CLOSED — workflow WITH outputs + no input/messages mapping
 *                    → Save stays DISABLED (fail-closed preserved)
 *
 * Uses the real isScenarioMappingValid / hasScenarioInputMapping via
 * importOriginal so the tests actually exercise the predicate change.
 *
 * @see specs/features/scenarios/minimal-input-mapping.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioInputMappingSectionProps } from "~/components/suites/ScenarioInputMappingSection";
import { AgentWorkflowEditorDrawer } from "../AgentWorkflowEditorDrawer";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  agentData: null as Record<string, unknown> | null,
  workflowData: null as Record<string, unknown> | null,
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

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

vi.mock("~/hooks/useDrawer", () => ({
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

// Partial mock: stub the heavy React component but keep the real
// isScenarioMappingValid / hasScenarioInputMapping so the save-gate tests
// exercise the actual predicate, not a mock.
vi.mock(
  "~/components/suites/ScenarioInputMappingSection",
  async (importOriginal) => {
    const mod =
      await importOriginal<
        typeof import("~/components/suites/ScenarioInputMappingSection")
      >();
    return {
      ...mod,
      ScenarioInputMappingSection: ({
        inputs,
      }: ScenarioInputMappingSectionProps) => (
        <div data-testid="scenario-mapping-section">
          {inputs.map((i) => (
            <div
              key={i.identifier}
              data-testid={`scenario-mapping-input-${i.identifier}`}
            >
              {i.identifier}
            </div>
          ))}
        </div>
      ),
    };
  },
);

vi.mock("~/utils/api", () => ({
  api: {
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

// ── DSL fixtures ──────────────────────────────────────────────────────────────

/**
 * Workflow with one entry output and one end-node input.
 * getMappingSurfaceInputs → [{identifier:"userMessage"}]
 * workflowOutputs → [{identifier:"response"}]  (structural guard passes)
 */
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

/**
 * Workflow with one entry output and NO end-node inputs.
 * workflowOutputs → []  (structural guard blocks Save regardless of mapping)
 */
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

// ── Agent fixtures ────────────────────────────────────────────────────────────

/**
 * Valid input mapping (userMessage → input) but scenarioOutputField is
 * explicitly cleared (""). The structural guard passes (workflow HAS outputs).
 *
 * RED case: isScenarioMappingValid returns false now because
 *   hasOutputMapping = (outputs.length > 0) && "" !== "" = false
 * After fix: returns hasScenarioInputMapping(mappings) = true → Save enabled.
 */
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

/**
 * Valid input mapping but the workflow has no end-node outputs.
 * workflowOutputs = [] → structural guard blocks Save.
 * Must remain DISABLED after the fix.
 */
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
    // No scenarioOutputField
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  description: null,
  copiedFromAgentId: null,
};

/**
 * Only threadId mapped — hasScenarioInputMapping returns false.
 * Workflow has outputs (structural guard passes), but input gate blocks Save.
 */
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDrawer(agentId: string) {
  return render(<AgentWorkflowEditorDrawer open={true} agentId={agentId} />, {
    wrapper: Wrapper,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AgentWorkflowEditorDrawer save gate", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  // (a) RED → GREEN ────────────────────────────────────────────────────────────
  describe("given a workflow with outputs and a valid input mapping but outputField explicitly cleared", () => {
    beforeEach(() => {
      mocks.agentData = AGENT_INPUT_MAPPING_CLEARED_OUTPUT;
      mocks.workflowData = {
        id: "workflow-with-outputs",
        name: "Full Workflow",
        projectId: "test-project",
        currentVersion: { id: "v1", dsl: DSL_WITH_OUTPUTS },
      };
    });

    describe("when the drawer renders with the pre-saved config", () => {
      /** @scenario Save workflow agent when output mapping is cleared but input mapping present */
      it("enables the Save Changes button", async () => {
        renderDrawer("agent-cleared-output");

        await waitFor(() => {
          expect(screen.getByTestId("save-agent-button")).not.toBeDisabled();
        });
      });
    });
  });

  // (b) REGRESSION GUARD ───────────────────────────────────────────────────────
  describe("given a workflow with no end outputs and a valid input mapping", () => {
    beforeEach(() => {
      mocks.agentData = AGENT_INPUT_MAPPING_NO_WORKFLOW_OUTPUTS;
      mocks.workflowData = {
        id: "workflow-no-outputs",
        name: "Inputs-Only Workflow",
        projectId: "test-project",
        currentVersion: { id: "v2", dsl: DSL_INPUTS_NO_OUTPUTS },
      };
    });

    describe("when the drawer renders with the pre-saved config", () => {
      /** @scenario Save workflow agent stays blocked when the workflow has no published outputs */
      it("keeps the Save Changes button disabled", async () => {
        renderDrawer("agent-no-wf-outputs");

        await waitFor(() => {
          expect(screen.getByTestId("save-agent-button")).toBeDisabled();
        });
      });
    });
  });

  // (c) FAIL-CLOSED ─────────────────────────────────────────────────────────────
  describe("given a workflow with outputs but no input-field mapping", () => {
    beforeEach(() => {
      mocks.agentData = AGENT_NO_INPUT_MAPPING;
      mocks.workflowData = {
        id: "workflow-with-outputs",
        name: "Full Workflow",
        projectId: "test-project",
        currentVersion: { id: "v3", dsl: DSL_WITH_OUTPUTS },
      };
    });

    describe("when the drawer renders with threadId-only mapping", () => {
      /** @scenario Save workflow agent stays blocked when no input mapping is configured */
      it("keeps the Save Changes button disabled", async () => {
        renderDrawer("agent-no-input");

        await waitFor(() => {
          expect(screen.getByTestId("save-agent-button")).toBeDisabled();
        });
      });
    });
  });
});
