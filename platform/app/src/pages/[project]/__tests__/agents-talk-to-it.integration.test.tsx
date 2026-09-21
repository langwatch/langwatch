/**
 * @vitest-environment jsdom
 *
 * The agents page's card menu Talk to it action opens the voice editor drawer
 * straight onto the call panel, rather than the editor form (#23).
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentsPage from "../agents";

const mockOpenDrawer = vi.fn();

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("~/components/WithPermissionGuard", () => ({
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
vi.mock("~/components/agents/voice/useVoiceAgentsEnabled", () => ({
  useVoiceAgentsEnabled: () => true,
}));
vi.mock("~/features/langy/components/LangyContextTarget", () => ({
  LangyContextTarget: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

const VOICE_AGENT = {
  id: "agent_voice",
  name: "Support line",
  type: "voice",
  config: { transport: "elevenlabs_convai", agentId: "el_agent" },
  updatedAt: new Date("2026-08-30T09:00:00Z"),
  createdAt: new Date("2026-08-30T09:00:00Z"),
  copiedFromAgentId: null,
};

vi.mock("~/utils/api", () => {
  const mutation = { mutate: vi.fn(), isPending: false };
  return {
    api: {
      useUtils: () => ({ agents: { getAll: { invalidate: vi.fn() } } }),
      agents: {
        getAll: { useQuery: () => ({ data: [VOICE_AGENT], isLoading: false }) },
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

  describe("given a voice agent's card menu action Talk to it", () => {
    /** @scenario "Talk to it appears on a voice agent's card menu while the flag is on" */
    it("opens the voice editor drawer with the call panel already open", async () => {
      render(<AgentsPage />, { wrapper: Wrapper });

      const user = userEvent.setup();
      await user.click(
        screen.getByLabelText(`Actions for ${VOICE_AGENT.name}`),
      );
      await user.click(
        await screen.findByTestId(`agent-talk-${VOICE_AGENT.id}`),
      );

      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "agentVoiceEditor",
        expect.objectContaining({
          urlParams: { agentId: VOICE_AGENT.id, talk: "1" },
        }),
      );
    });
  });
});
