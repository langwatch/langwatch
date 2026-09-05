/**
 * Regression tests for #3193: the Add New Agent flow from Edit Scenario navigated nowhere because the registry-mounted agent editor drawers never computed `open=true`.
 * @vitest-environment jsdom
 * @see specs/features/scenarios/scenarios-editor-ui-regressions.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drawerState = vi.hoisted(() => ({ open: "" as string }));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: (drawer: string) => drawer === drawerState.open,
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
    organization: { id: "test-org" },
    team: null,
  }),
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    query: { project: "test-project" },
    asPath: "/test",
    isReady: true,
  }),
}));

vi.mock(
  "@langwatch/workflow-web/optimization_studio/components/code/workflow-code-editor.transport",
  () => ({
    CodeEditor: () => null,
    CodeEditorModal: () => null,
  }),
);

vi.mock("@langwatch/workflow-web/components/blocks/CodeBlockEditor", () => ({
  CodeBlockEditor: () => <div data-testid="code-editor" />,
}));

vi.mock("../../../../behavior/scenario-api", () => ({
  api: {
    agents: {
      getById: {
        useQuery: () => ({ data: null, isLoading: false, error: null }),
      },
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
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      testTurn: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
          data: void 0,
          error: null,
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
    workflow: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
      create: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
    workflows: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    useUtils: () => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
  },
}));

import {
  AgentCodeEditorDrawerFromUrl,
  AgentHttpEditorDrawerFromUrl,
  WorkflowSelectorDrawerFromUrl,
} from "../drawer-from-url";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Agent editor drawer *FromUrl wrappers", () => {
  beforeEach(() => {
    drawerState.open = "";
  });
  afterEach(cleanup);

  describe("given the registry mounts AgentHttpEditorDrawerFromUrl with no open prop", () => {
    describe("when the URL names agentHttpEditor", () => {
      /** @scenario "Clicking HTTP Agent in the type selector opens the HTTP editor drawer" */
      /** @scenario "HTTP agent editor renders Scenario Mappings section" */
      it("mounts the HTTP editor with its form visible", async () => {
        drawerState.open = "agentHttpEditor";

        render(<AgentHttpEditorDrawerFromUrl />, { wrapper: Wrapper });

        await waitFor(() => {
          expect(screen.getByText("New HTTP Agent")).toBeInTheDocument();
        });
        expect(screen.getByText("Scenario Mappings")).toBeInTheDocument();
      });
    });

    describe("when the URL names another drawer", () => {
      it("keeps the HTTP editor closed", () => {
        drawerState.open = "workflowSelector";

        render(<AgentHttpEditorDrawerFromUrl />, { wrapper: Wrapper });

        expect(screen.queryByText("New HTTP Agent")).not.toBeInTheDocument();
      });
    });
  });

  describe("given the registry mounts AgentCodeEditorDrawerFromUrl with no open prop", () => {
    describe("when the URL names agentCodeEditor", () => {
      /** @scenario "Clicking Code Agent in the type selector opens the code editor drawer" */
      it("mounts the code editor with its form visible", async () => {
        drawerState.open = "agentCodeEditor";

        render(<AgentCodeEditorDrawerFromUrl />, { wrapper: Wrapper });

        await waitFor(() => {
          expect(screen.getByText("Agent Name")).toBeInTheDocument();
        });
      });
    });
  });

  describe("given the registry mounts WorkflowSelectorDrawerFromUrl with no open prop", () => {
    describe("when the URL names workflowSelector", () => {
      /** @scenario "Clicking Workflow Agent in the type selector opens the workflow selector drawer" */
      it("mounts the workflow selector with its content visible", async () => {
        drawerState.open = "workflowSelector";

        render(<WorkflowSelectorDrawerFromUrl />, { wrapper: Wrapper });

        await waitFor(() => {
          expect(
            screen.getByRole("heading", { name: /create workflow agent/i }),
          ).toBeInTheDocument();
        });
      });
    });
  });
});
