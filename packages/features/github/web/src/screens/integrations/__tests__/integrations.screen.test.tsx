/**
 * @vitest-environment jsdom
 *
 * Settings → Integrations: what an organization manager sees about its GitHub
 * connection, and where each action sends them.
 *
 * THE PLATFORM PAGE HAD NO SUITE AT ALL. Nothing mounted it, so nothing
 * asserted the three decisions it actually makes: that an unconfigured instance
 * is told so instead of being offered a dead button, that the install address is
 * the server's own with the redirect mode and the return address appended, and
 * that a failed round-trip is reported once and then dropped out of the URL.
 * The last is the one worth pinning — left in the address, the same failure is
 * reported again on every reload.
 *
 * Spec: specs/integrations/github-connection.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeGithubHost, renderWithGithubHost } from "../../../testing";
import IntegrationsScreen from "../integrations.screen";

const { state } = vi.hoisted(() => ({
  state: {
    status: undefined as Record<string, unknown> | undefined,
    disconnectResult: { uninstallUrl: "https://github.com/settings/installations/42" },
  },
}));

const calls = vi.hoisted(() => ({
  statusQuery: vi.fn(),
  disconnect: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("../../../behavior/github-api", () => ({
  githubApi: {
    github: {
      getConnectionStatus: {
        useQuery: (input: unknown) => {
          calls.statusQuery(input);
          return { data: state.status, isLoading: false, refetch: calls.refetch };
        },
      },
      disconnect: {
        useMutation: (options?: {
          onSuccess?: (
            data: { uninstallUrl: string },
            variables: { organizationId: string; installationId: string },
          ) => void;
          onError?: (error: unknown) => void;
        }) => ({
          isPending: false,
          mutate: (input: { organizationId: string; installationId: string }) => {
            calls.disconnect(input);
            options?.onSuccess?.(state.disconnectResult, input);
          },
        }),
      },
    },
  },
}));

const installation = (overrides: Record<string, unknown> = {}) => ({
  installationId: "inst_1",
  accountLogin: "acme",
  accountType: "Organization",
  repositorySelection: "selected",
  repositoryCount: 3,
  suspended: false,
  uninstallUrl: "https://github.com/organizations/acme/settings/installations/inst_1",
  ...overrides,
});

beforeEach(() => {
  state.status = {
    configured: true,
    connected: false,
    installations: [],
    installUrl: "https://github.com/apps/langwatch/installations/new?state=abc",
  };
  calls.statusQuery.mockClear();
  calls.disconnect.mockClear();
  calls.refetch.mockClear();
});

afterEach(() => cleanup());

describe("given an instance with the GitHub App configured", () => {
  describe("when nothing is installed yet", () => {
    /** @scenario An organization manager is offered the GitHub install */
    it("offers to connect, and asks the status for the organization in scope", () => {
      renderWithGithubHost(<IntegrationsScreen />, new FakeGithubHost({ scope: { organizationId: "org-7" } }));

      expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeEnabled();
      expect(calls.statusQuery).toHaveBeenCalledWith({ organizationId: "org-7" });
    });

    /** @scenario Connecting leaves for the server's own install address */
    it("leaves for the install address the server handed back, in redirect mode", async () => {
      const user = userEvent.setup();
      const { host } = renderWithGithubHost(<IntegrationsScreen />);

      await user.click(screen.getByRole("button", { name: "Connect GitHub" }));

      expect(host.departures).toEqual([
        "https://github.com/apps/langwatch/installations/new?state=abc" +
          "&mode=redirect&return=%2Fsettings%2Fintegrations%23github",
      ]);
    });
  });

  describe("when an account is already installed", () => {
    beforeEach(() => {
      state.status = {
        configured: true,
        connected: true,
        installations: [installation()],
        installUrl: "https://github.com/apps/langwatch/installations/new?state=abc",
      };
    });

    /** @scenario A connected organization sees which accounts it reaches */
    it("names the account, how many repositories it covers, and says it is installed", () => {
      renderWithGithubHost(<IntegrationsScreen />);

      expect(screen.getByText("@acme")).toBeInTheDocument();
      expect(screen.getByText("3 selected repositories")).toBeInTheDocument();
      expect(screen.getByText("Installed")).toBeInTheDocument();
    });

    /** @scenario A single-repository install reads as one repository */
    it("says repository rather than repositories for a single-repository install", () => {
      state.status = {
        ...state.status,
        installations: [installation({ repositoryCount: 1 })],
      };
      renderWithGithubHost(<IntegrationsScreen />);

      expect(screen.getByText("1 selected repository")).toBeInTheDocument();
    });

    /** @scenario Disconnecting hands the reader to GitHub to finish */
    it("opens GitHub's uninstall page and says the row updates once GitHub confirms", async () => {
      const user = userEvent.setup();
      const { host } = renderWithGithubHost(<IntegrationsScreen />);

      await user.click(screen.getByRole("button", { name: "Disconnect" }));

      expect(calls.disconnect).toHaveBeenCalledWith({
        organizationId: "org-1",
        installationId: "inst_1",
      });
      expect(host.externals).toEqual(["https://github.com/settings/installations/42"]);
      expect(calls.refetch).toHaveBeenCalled();
      expect(
        await screen.findByText("Finish uninstalling on GitHub — this updates once GitHub confirms."),
      ).toBeInTheDocument();
    });
  });
});

describe("given an instance with no GitHub App configured", () => {
  beforeEach(() => {
    state.status = { configured: false, connected: false, installations: [], installUrl: null };
  });

  /** @scenario App not configured on the instance hides the feature */
  it("says the integration is unavailable and offers no install button", () => {
    renderWithGithubHost(<IntegrationsScreen />);

    expect(
      screen.getByText("The GitHub integration is not available on this instance."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).not.toBeInTheDocument();
  });
});

describe("given the install round-trip came back with a failure", () => {
  /** @scenario A failed installation is reported once and dropped from the address */
  it("reports the failure and clears it out of the query string", async () => {
    const host = new FakeGithubHost({ query: { githubError: "Installation was cancelled" } });
    renderWithGithubHost(<IntegrationsScreen />, host);

    await waitFor(() => expect(host.failures).toHaveLength(1));
    expect(host.failures[0]).toMatchObject({
      fallbackTitle: "GitHub installation failed",
      description: "Installation was cancelled",
    });
    expect(host.queryWrites).toEqual([
      { next: { githubError: void 0 }, options: { replace: true } },
    ]);
  });
});

describe("given the organization is still arriving", () => {
  /** @scenario The settings chrome frames the page before the organization lands */
  it("renders its own loading state rather than an empty frame", () => {
    renderWithGithubHost(
      <IntegrationsScreen />,
      new FakeGithubHost({ scope: { organizationId: void 0 } }),
    );

    expect(screen.getByTestId("integrations-loading")).toBeInTheDocument();
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
  });
});
