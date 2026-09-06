/**
 * @vitest-environment jsdom
 *
 * Integration tests for AgentHttpEditorDrawer.
 *
 * Gap B — HTTP agent editor must render ScenarioInputMappingSection
 * (mirrors the pattern already present in AgentCodeEditorDrawer).
 *
 * @see specs/scenarios/scenario-input-mapping.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHttpEditorDrawer } from "../AgentHttpEditorDrawer";

// -- Transitive-dependency mocks (mirrors AgentCodeEditorDrawer.test.tsx) --

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: { project: "test-project" },
    asPath: "/test",
  }),
}));

vi.mock("next-auth/react", () => ({
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

vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
  CodeEditorModal: () => null,
}));

/** What `agents.getById` answers with, so a test can open a saved agent. */
let mockAgentById: {
  id: string;
  name: string;
  config: Record<string, unknown>;
} | null = null;

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

vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getById: {
        useQuery: () => ({
          data: mockAgentById,
          isLoading: false,
          error: null,
        }),
      },
      getAll: {
        invalidate: vi.fn(),
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
      testTurn: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      testRun: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
    httpProxy: {
      execute: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ output: "test" }),
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
  },
}));

// -- Helpers --

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderHttpDrawer(
  props: Partial<Parameters<typeof AgentHttpEditorDrawer>[0]> = {},
) {
  return render(<AgentHttpEditorDrawer open={true} {...props} />, {
    wrapper: Wrapper,
  });
}

// -- Tests --

describe("AgentHttpEditorDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentById = null;
  });
  afterEach(cleanup);

  // ==========================================================================
  // HTTP agent editor basic rendering
  // ==========================================================================

  describe("given the HTTP agent editor is open", () => {
    describe("when the drawer renders", () => {
      it("renders the drawer", async () => {
        renderHttpDrawer();

        await waitFor(() => {
          expect(screen.getByText("New HTTP Agent")).toBeInTheDocument();
        });
      });

      /** @scenario HTTP agent editor renders Scenario Mappings section */
      it("renders the Scenario Mappings section", async () => {
        renderHttpDrawer();

        await waitFor(() => {
          expect(screen.getByText("Scenario Mappings")).toBeInTheDocument();
        });
      });

      /** @scenario "The HTTP agent editor offers a session path" */
      it("renders the session path field beside the output path", async () => {
        renderHttpDrawer();

        await waitFor(() => {
          expect(
            screen.getByText("Output Path (JSONPath)"),
          ).toBeInTheDocument();
        });
        expect(screen.getByText("Session path")).toBeInTheDocument();
        expect(
          screen.getByPlaceholderText("$.conversation_id"),
        ).toBeInTheDocument();
      });

      /** @scenario "The HTTP agent editor offers a session path" */
      it("opens the session path guidance from a focusable control", async () => {
        renderHttpDrawer();

        await waitFor(() => {
          expect(screen.getByText("Session path")).toBeInTheDocument();
        });
        const help = screen.getByRole("button", {
          name: "More about the session path",
        });
        help.focus();
        expect(help).toHaveFocus();
      });
    });

    describe("when a saved agent is followed by a new draft", () => {
      /** @scenario "The HTTP agent editor offers a session path" */
      it("clears the session path the saved agent carried", async () => {
        mockAgentById = {
          id: "agent_1",
          name: "Saved agent",
          config: {
            url: "https://example.com/agent",
            sessionPath: "$.conversation_id",
          },
        };
        const { rerender } = render(
          <AgentHttpEditorDrawer open={true} agentId="agent_1" />,
          { wrapper: Wrapper },
        );

        await waitFor(() => {
          expect(screen.getByPlaceholderText("$.conversation_id")).toHaveValue(
            "$.conversation_id",
          );
        });

        mockAgentById = null;
        rerender(<AgentHttpEditorDrawer open={true} />);

        await waitFor(() => {
          expect(screen.getByPlaceholderText("$.conversation_id")).toHaveValue(
            "",
          );
        });
      });
    });
  });
});
