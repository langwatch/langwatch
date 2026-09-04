/**
 * @vitest-environment jsdom
 *
 * Disconnecting the project's Slack connection is destructive to every
 * automation that posts through it: those automations carry no token of their
 * own, so the connection going away is the moment their delivery stops, and
 * nothing about the automation itself changes to say so. The settings card
 * therefore asks first, and the question names the number.
 *
 * Spec: specs/automations/source-merge.feature, "Slack is set up once per
 * project".
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the server says about this project's connection, per test. */
const slackStatus = vi.hoisted(() => ({
  current: {
    connected: true,
    slackTeamId: "T123",
    slackTeamName: "Acme HQ",
    connectedAt: null as Date | null,
    updatedAt: null as Date | null,
    dependentAutomations: 3,
    canManage: true,
  },
  /** The status read is still in flight — nothing is known yet. */
  loading: false,
}));
/** Every disconnect the card actually sent — the point of the confirmation is
 *  that this stays empty until the operator confirms. */
const disconnectCalls = vi.hoisted(() => [] as { projectId: string }[]);

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/settings/integrations",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      slackIntegration: {
        getStatus: { invalidate: vi.fn() },
        getLegacyTokenCensus: { invalidate: vi.fn() },
      },
    }),
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
    slackIntegration: {
      getStatus: {
        useQuery: () =>
          slackStatus.loading
            ? { data: undefined, isLoading: true, error: null }
            : { data: slackStatus.current, isLoading: false, error: null },
      },
      getLegacyTokenCensus: {
        useQuery: () => ({ data: { count: 0, automations: [] } }),
      },
      connect: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      disconnect: {
        useMutation: () => ({
          mutate: (input: { projectId: string }) => {
            disconnectCalls.push(input);
          },
          isPending: false,
        }),
      },
      switchToIntegration: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: {
      id: "org-1",
      name: "Acme Corp",
      teams: [
        {
          id: "team-1",
          name: "Checkout team",
          projects: [{ id: "project-1", name: "Checkout" }],
        },
      ],
    },
    project: { id: "project-1", name: "Checkout", slug: "checkout" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (C: any) => C,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import IntegrationsSettings from "../integrations";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IntegrationsSettings />
    </ChakraProvider>,
  );
}

const clickDisconnect = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Disconnect" }));
  return user;
};

describe("given the project's Slack connection is still being checked", () => {
  beforeEach(() => {
    slackStatus.loading = true;
  });

  afterEach(() => {
    slackStatus.loading = false;
    cleanup();
  });

  /** @scenario "The Slack card waits for the connection check before offering or withholding actions" */
  it("says it is checking and neither offers actions nor tells the user to ask an administrator", () => {
    renderPage();

    expect(
      screen.getByText(/Checking this project.s Slack connection/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ask a project administrator/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });
});

describe("given a project whose Slack connection several automations post through", () => {
  beforeEach(() => {
    disconnectCalls.length = 0;
    slackStatus.current = {
      connected: true,
      slackTeamId: "T123",
      slackTeamName: "Acme HQ",
      connectedAt: null,
      updatedAt: null,
      dependentAutomations: 3,
      canManage: true,
    };
  });

  afterEach(() => cleanup());

  describe("when the operator presses Disconnect", () => {
    /** @scenario "Disconnecting Slack is confirmed with what stops delivering" */
    it("asks first, naming how many automations stop delivering", async () => {
      renderPage();

      await clickDisconnect();

      await waitFor(() => {
        expect(screen.getByText("Disconnect Slack?")).toBeInTheDocument();
      });
      expect(
        screen.getByText(
          "3 automations deliver through this connection and will stop delivering until Slack is reconnected.",
        ),
      ).toBeInTheDocument();
    });

    /** @scenario "Disconnecting Slack is confirmed with what stops delivering" */
    it("disconnects nothing until the operator confirms", async () => {
      renderPage();

      await clickDisconnect();

      await waitFor(() => {
        expect(screen.getByText("Disconnect Slack?")).toBeInTheDocument();
      });
      expect(disconnectCalls).toEqual([]);
    });

    /** @scenario "Disconnecting Slack is confirmed with what stops delivering" */
    it("leaves the connection alone when the operator cancels", async () => {
      renderPage();

      const user = await clickDisconnect();
      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(disconnectCalls).toEqual([]);
    });

    /** @scenario "Disconnecting Slack is confirmed with what stops delivering" */
    it("disconnects the picked project once the operator confirms", async () => {
      renderPage();

      const user = await clickDisconnect();
      await user.click(
        await screen.findByRole("button", { name: "Disconnect Slack" }),
      );

      expect(disconnectCalls).toEqual([{ projectId: "project-1" }]);
    });
  });

  describe("when exactly one automation posts through the connection", () => {
    /** @scenario "Disconnecting Slack is confirmed with what stops delivering" */
    it("says so in the singular", async () => {
      slackStatus.current = {
        ...slackStatus.current,
        dependentAutomations: 1,
      };
      renderPage();

      await clickDisconnect();

      expect(
        await screen.findByText(
          "1 automation delivers through this connection and will stop delivering until Slack is reconnected.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when nothing posts through the connection", () => {
    /** @scenario "Disconnecting Slack is confirmed with what stops delivering" */
    it("says nothing is lost rather than warning about automations", async () => {
      slackStatus.current = {
        ...slackStatus.current,
        dependentAutomations: 0,
      };
      renderPage();

      await clickDisconnect();

      expect(
        await screen.findByText(
          "Nothing delivers through this connection yet.",
        ),
      ).toBeInTheDocument();
    });
  });
});
