/**
 * @vitest-environment jsdom
 *
 * Regression tests for #3193: Add New Agent flow from Edit Scenario
 * navigates nowhere because the registry-mounted agent editor drawers
 * never compute `open=true`.
 *
 * Repro: `CurrentDrawer` mounts a drawer with `{...queryDrawer}`, where
 * `queryDrawer.open` is the drawer-name STRING parsed from the URL
 * (e.g. `"agentHttpEditor"`), not a boolean. The drawer must treat the
 * presence of any defined `open` prop as "open" so the registry-driven
 * mount surface continues to function.
 *
 * The fix mirrors #1989's `ScenarioFormDrawerFromUrl` pattern — small
 * `*FromUrl` wrappers that coerce the URL state into a boolean before
 * delegating to the underlying drawer.
 *
 * @see specs/features/scenarios/scenarios-editor-ui-regressions.feature
 */
import type React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -- Shared mocks (cover transitive deps across all three drawers) ----------

const mockCloseDrawer = vi.fn();
const mockGoBack = vi.fn();
const mockOpenDrawer = vi.fn();
const mockDrawerOpen = vi.fn((_drawer: string) => false as boolean);

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    query: { project: "test-project" },
    asPath: "/test",
    isReady: true,
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

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    drawerOpen: mockDrawerOpen,
    canGoBack: false,
    goBack: mockGoBack,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getById: {
        useQuery: () => ({ data: null, isLoading: false, error: null }),
      },
      getAll: {
        invalidate: vi.fn(),
        useQuery: () => ({ data: [], isLoading: false }),
      },
      create: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      update: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
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
    workflow: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      create: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
    workflows: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false }),
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

// Drawer registry imports the modules directly — pull them after mocks are set.
import {
  AgentHttpEditorDrawerFromUrl,
  AgentCodeEditorDrawerFromUrl,
  WorkflowSelectorDrawerFromUrl,
} from "../drawerFromUrl";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Agent editor drawer *FromUrl wrappers (regression #3193)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrawerOpen.mockReset();
  });
  afterEach(cleanup);

  describe("given CurrentDrawer mounts AgentHttpEditorDrawerFromUrl without an `open` prop", () => {
    /** @scenario "Clicking HTTP Agent in the type selector opens the HTTP editor drawer" */
    it("opens when the URL indicates agentHttpEditor is active", async () => {
      mockDrawerOpen.mockImplementation(
        (drawer: string) => drawer === "agentHttpEditor",
      );

      render(<AgentHttpEditorDrawerFromUrl />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("New HTTP Agent")).toBeInTheDocument();
      });
    });

    it("stays closed when the URL does not indicate agentHttpEditor is active", () => {
      mockDrawerOpen.mockReturnValue(false);

      render(<AgentHttpEditorDrawerFromUrl />, { wrapper: Wrapper });

      expect(screen.queryByText("New HTTP Agent")).not.toBeInTheDocument();
    });
  });

  describe("given CurrentDrawer mounts AgentCodeEditorDrawerFromUrl without an `open` prop", () => {
    /** @scenario "Clicking Code Agent in the type selector opens the code editor drawer" */
    it("opens when the URL indicates agentCodeEditor is active", async () => {
      mockDrawerOpen.mockImplementation(
        (drawer: string) => drawer === "agentCodeEditor",
      );

      render(<AgentCodeEditorDrawerFromUrl />, { wrapper: Wrapper });

      await waitFor(() => {
        // AgentCodeEditorDrawer renders an "Agent name" label in its header
        expect(screen.getByText(/Agent name/i)).toBeInTheDocument();
      });
    });
  });

  describe("given CurrentDrawer mounts WorkflowSelectorDrawerFromUrl without an `open` prop", () => {
    /** @scenario "Clicking Workflow Agent in the type selector opens the workflow selector drawer" */
    it("opens when the URL indicates workflowSelector is active", async () => {
      mockDrawerOpen.mockImplementation(
        (drawer: string) => drawer === "workflowSelector",
      );

      render(<WorkflowSelectorDrawerFromUrl />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: /create workflow agent/i }),
        ).toBeInTheDocument();
      });
    });
  });
});
