/**
 * @vitest-environment jsdom
 *
 * Settings → Integrations lists every Slack connection the project can use and
 * opens the one connection drawer to add or edit them.
 * Spec: specs/automations/slack-connections.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connections: [] as Array<Record<string, unknown>>,
  canManageProject: true,
  canManageOrganization: false,
  openDrawer: vi.fn(),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/settings/integrations",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: state.openDrawer }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    github: {
      getConnectionStatus: {
        useQuery: () => ({
          data: {
            configured: false,
            connected: false,
            installations: [],
            installUrl: "",
          },
        }),
      },
      disconnect: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    langy: {
      getCodeAccessPreference: {
        useQuery: () => ({ data: { preference: null }, refetch: vi.fn() }),
      },
      setCodeAccessPreference: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    slackIntegration: {
      list: {
        useQuery: () => ({
          data: {
            connections: state.connections,
            canManageProject: state.canManageProject,
            canManageOrganization: state.canManageOrganization,
          },
          error: null,
        }),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme Corp" },
    project: { id: "project-1", name: "Checkout", slug: "checkout" },
    hasPermission: () => false,
  }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (C: unknown) => C,
}));

import IntegrationsSettings from "../integrations";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IntegrationsSettings />
    </ChakraProvider>,
  );
}

const connection = (overrides: Record<string, unknown>) => ({
  id: "conn-1",
  name: "Alerts bot",
  kind: "BOT",
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  scopeName: "Acme Corp",
  secretHint: "abcd",
  slackTeamId: "T1",
  slackTeamName: "Acme HQ",
  dependentAutomations: 3,
  canManage: false,
  updatedAt: new Date(),
  ...overrides,
});

describe("Integrations settings, Slack section", () => {
  beforeEach(() => {
    state.connections = [];
    state.canManageProject = true;
    state.canManageOrganization = false;
    state.openDrawer.mockReset();
  });

  afterEach(() => cleanup());

  describe("given the project can use an organization and a project connection", () => {
    beforeEach(() => {
      state.connections = [
        connection({}),
        connection({
          id: "conn-2",
          name: "Ops webhook",
          kind: "INCOMING_WEBHOOK",
          scopeType: "PROJECT",
          scopeId: "project-1",
          scopeName: "Checkout",
          secretHint: "wxyz",
          slackTeamId: null,
          slackTeamName: null,
          dependentAutomations: 1,
          canManage: true,
        }),
      ];
    });

    /** @scenario "Settings lists connections and opens the drawer" */
    it("lists each with its kind, whose it is, workspace or hint, and usage", () => {
      renderPage();

      const bot = screen.getByRole("button", {
        name: "Edit Alerts bot",
      });
      expect(within(bot).getByText("Bot")).toBeInTheDocument();
      expect(within(bot).getByText("Organization")).toBeInTheDocument();
      expect(within(bot).getByText("Acme HQ")).toBeInTheDocument();
      expect(
        within(bot).getByText("Used by 3 automations"),
      ).toBeInTheDocument();

      const webhook = screen.getByRole("button", {
        name: "Edit Ops webhook",
      });
      expect(within(webhook).getByText("Webhook")).toBeInTheDocument();
      expect(within(webhook).getByText("This project")).toBeInTheDocument();
      expect(within(webhook).getByText("••••wxyz")).toBeInTheDocument();
      expect(
        within(webhook).getByText("Used by 1 automation"),
      ).toBeInTheDocument();
    });

    /** @scenario "Settings lists connections and opens the drawer" */
    it("opens the connection drawer from a row and from Add", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(
        screen.getByRole("button", {
          name: "Edit Ops webhook",
        }),
      );
      await user.click(
        screen.getByRole("button", { name: /add slack connection/i }),
      );

      expect(state.openDrawer).toHaveBeenNthCalledWith(1, "slackConnection", {
        connectionId: "conn-2",
      });
      expect(state.openDrawer).toHaveBeenNthCalledWith(
        2,
        "slackConnection",
        {},
      );
    });
  });

  describe("given the project has no Slack connection", () => {
    it("says so", () => {
      renderPage();

      expect(screen.getByText("No Slack connections yet.")).toBeInTheDocument();
    });
  });

  describe("given the reader can manage neither the project nor the organization", () => {
    it("offers no way to add one", () => {
      state.canManageProject = false;
      renderPage();

      expect(
        screen.queryByRole("button", { name: /add slack connection/i }),
      ).not.toBeInTheDocument();
    });
  });
});
