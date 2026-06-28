/**
 * @vitest-environment jsdom
 *
 * Integration tests for AgentCodeEditorDrawer Save gate — Issue #3412
 *
 * AgentCodeEditorDrawer.tsx computes:
 *   isValid = name.trim().length > 0 &&
 *             isScenarioMappingValid({ mappings: scenarioMappings })
 *
 * There is NO structural workflowOutputs.length guard here — the code agent
 * always has its own outputs declared in state (DEFAULT_OUTPUTS or loaded from
 * config). The only gate is isScenarioMappingValid.
 *
 * After the fix (isScenarioMappingValid drops && hasOutputMapping), a code agent
 * with a valid input mapping must be saveable even when the user has explicitly
 * cleared the output-field selection (scenarioOutputField = "").
 *
 * Test matrix:
 *   (a) RED→GREEN  — valid input mapping + outputs present + outputField
 *                    explicitly cleared ("") → Save ENABLED after fix
 *   (b) FAIL-CLOSED — only threadId mapped (no input/messages) → Save stays
 *                    DISABLED (fail-closed preserved)
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
import { AgentCodeEditorDrawer } from "../AgentCodeEditorDrawer";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  agentData: null as Record<string, unknown> | null,
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

vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
  CodeEditorModal: () => null,
}));

vi.mock("~/components/blocks/CodeBlockEditor", () => ({
  CodeBlockEditor: ({
    code,
    onChange,
  }: {
    code: string;
    onChange: (code: string) => void;
  }) => (
    <div data-testid="code-editor">
      <textarea
        data-testid="code-textarea"
        value={code}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  ),
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
      create: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ id: "new-agent-id" }),
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({}),
          isPending: false,
        }),
      },
    },
    useContext: () => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
  },
}));

// ── Agent fixtures ────────────────────────────────────────────────────────────

/**
 * Code agent with a valid input mapping (userQuery → input), outputs present,
 * but scenarioOutputField explicitly cleared ("").
 *
 * RED case: isScenarioMappingValid returns false now because
 *   hasOutputMapping = (outputs.length > 0) && "" !== "" = false
 * After fix: returns hasScenarioInputMapping(mappings) = true → Save enabled.
 */
const CODE_AGENT_INPUT_MAPPED_OUTPUT_CLEARED = {
  id: "code-agent-cleared",
  name: "Code Agent Cleared Output",
  type: "code" as const,
  projectId: "test-project",
  config: {
    name: "Code",
    description: "Python code block",
    parameters: [
      {
        identifier: "code",
        type: "code",
        value:
          "class Code:\n    def __call__(self, userQuery: str):\n        return {'response': userQuery}",
      },
    ],
    inputs: [{ identifier: "userQuery", type: "str" }],
    outputs: [{ identifier: "response", type: "str" }],
    scenarioMappings: {
      userQuery: {
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
 * Code agent where the mapping does NOT wire "input" or "messages" — only
 * threadId. hasScenarioInputMapping returns false for this config.
 */
const CODE_AGENT_NO_INPUT_MAPPING = {
  id: "code-agent-no-input",
  name: "Code Agent No Input Mapping",
  type: "code" as const,
  projectId: "test-project",
  config: {
    name: "Code",
    description: "Python code block",
    parameters: [
      {
        identifier: "code",
        type: "code",
        value:
          "class Code:\n    def __call__(self, sessionId: str):\n        return {'response': sessionId}",
      },
    ],
    inputs: [{ identifier: "sessionId", type: "str" }],
    outputs: [{ identifier: "response", type: "str" }],
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
  return render(<AgentCodeEditorDrawer open={true} agentId={agentId} />, {
    wrapper: Wrapper,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AgentCodeEditorDrawer save gate", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  // (a) RED → GREEN ────────────────────────────────────────────────────────────
  describe("given a code agent with a valid input mapping but outputField explicitly cleared", () => {
    beforeEach(() => {
      mocks.agentData = CODE_AGENT_INPUT_MAPPED_OUTPUT_CLEARED;
    });

    describe("when the drawer renders with the pre-saved config", () => {
      /** @scenario Save code agent when output mapping is cleared but input mapping present */
      it("enables the Save Changes button", async () => {
        renderDrawer("code-agent-cleared");

        await waitFor(() => {
          expect(screen.getByTestId("save-agent-button")).not.toBeDisabled();
        });
      });
    });
  });

  // (b) FAIL-CLOSED ─────────────────────────────────────────────────────────────
  describe("given a code agent with no input-field mapping", () => {
    beforeEach(() => {
      mocks.agentData = CODE_AGENT_NO_INPUT_MAPPING;
    });

    describe("when the drawer renders with threadId-only mapping", () => {
      /** @scenario Save code agent stays blocked when no input mapping is configured */
      it("keeps the Save Changes button disabled", async () => {
        renderDrawer("code-agent-no-input");

        await waitFor(() => {
          expect(screen.getByTestId("save-agent-button")).toBeDisabled();
        });
      });
    });
  });
});
