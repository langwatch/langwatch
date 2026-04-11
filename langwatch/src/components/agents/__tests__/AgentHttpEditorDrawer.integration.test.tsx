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

import type React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHttpEditorDrawer } from "../AgentHttpEditorDrawer";

// -- Transitive-dependency mocks (mirrors AgentCodeEditorDrawer.test.tsx) --

vi.mock("next/router", () => ({
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
          data: null,
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
    },
    httpProxy: {
      execute: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ output: "test" }),
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
  beforeEach(() => vi.clearAllMocks());
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
    });

    // ========================================================================
    // Scenario Mappings section (issue #3064)
    // ========================================================================

    describe("when the editor renders the Body tab", () => {
      it("renders the Scenario Mappings section below the body template", async () => {
        renderHttpDrawer();

        await waitFor(() => {
          expect(screen.getByText("Scenario Mappings")).toBeInTheDocument();
        });
      });
    });
  });
});
