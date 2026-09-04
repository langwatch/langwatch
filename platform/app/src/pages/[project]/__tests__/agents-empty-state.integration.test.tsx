/**
 * @vitest-environment jsdom
 *
 * The agents page with no agent of any kind.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockOpenDrawer = vi.fn();

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("~/components/WithPermissionGuard", () => ({
  // The guard needs a session; the empty state does not.
  withPermissionGuard:
    (_permission: string, _options: unknown) =>
    <P extends object>(Component: React.ComponentType<P>) =>
      Component,
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({}),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "acme" },
  }),
}));
// The dialogs the page mounts have their own tests and their own API
// surface; the empty state never opens them.
vi.mock("~/components/agents/CopyAgentDialog", () => ({
  CopyAgentDialog: () => null,
}));
vi.mock("~/components/agents/PushToCopiesDialog", () => ({
  PushToCopiesDialog: () => null,
}));
vi.mock("~/components/CascadeArchiveDialog", () => ({
  CascadeArchiveDialog: () => null,
}));
vi.mock("~/components/agents/useAgentTestRun", () => ({
  useAgentTestRun: () => ({ testAgent: vi.fn() }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn(), query: {}, asPath: "/acme/agents" }),
}));
vi.mock("~/utils/api", () => {
  const emptyQuery = { data: [], isLoading: false };
  const mutation = { mutate: vi.fn(), isPending: false };
  return {
    api: {
      useUtils: () => ({ agents: { getAll: { invalidate: vi.fn() } } }),
      agents: {
        getAll: { useQuery: () => emptyQuery },
        syncFromSource: { useMutation: () => mutation },
        delete: { useMutation: () => mutation },
        getRelatedEntities: { useQuery: () => ({ isLoading: false }) },
        cascadeArchive: { useMutation: () => mutation },
      },
    },
  };
});

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("the agents page", () => {
  afterEach(cleanup);

  describe("given the project has no agent of any kind", () => {
    /** @scenario "An empty agents page still opens the new agent flow" */
    it("draws an empty state whose control opens the new agent flow", async () => {
      const { default: AgentsPage } = await import("../agents");
      render(<AgentsPage />, { wrapper: Wrapper });

      const control = screen.getByTestId("agents-empty-new-agent");
      control.click();
      expect(mockOpenDrawer).toHaveBeenCalledWith("agentTypeSelector");
    });
  });
});
