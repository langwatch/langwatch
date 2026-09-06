/**
 * @vitest-environment jsdom
 *
 * Covers the "Setup callback rejects a tampered or expired state" scenario
 * from specs/integrations/github-connection.feature: "I am shown that the
 * installation could not be verified".
 *
 * The `/setup` callback (src/server/routes/github.ts) reports every
 * failure by redirecting back with a `?githubError=<message>` query param,
 * but nothing on this page used to read it — a failed install (or a
 * cross-tenant conflict, or an expired signed state) silently re-rendered the
 * plain "Install" button, indistinguishable from nothing having happened.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockRouterQuery = vi.hoisted(() => ({
  current: {} as Record<string, string>,
}));
// Applies the replacement query like the real router.replace would, so a
// rerender after cleanup reflects the post-cleanup URL.
const routerReplace = vi.fn(
  (url: { pathname?: string; query?: Record<string, string> }) => {
    mockRouterQuery.current = { ...(url.query ?? {}) };
    return Promise.resolve(true);
  },
);

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockRouterQuery.current,
    pathname: "/settings/integrations",
    push: vi.fn(),
    replace: routerReplace,
    isReady: true,
  }),
}));

const connectionStatus = vi.hoisted(() => ({
  current: {
    configured: true,
    connected: false,
    installations: [] as unknown[],
    installUrl: "/api/github/install?organizationId=org-1",
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    github: {
      getConnectionStatus: {
        useQuery: () => ({ data: connectionStatus.current }),
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
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme Corp" },
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

import { toaster } from "~/components/ui/toaster";
import IntegrationsSettings from "../integrations";

const CONNECTED_STATUS = {
  configured: true,
  connected: true,
  installations: [
    {
      installationId: "555",
      accountLogin: "acme",
      accountType: "Organization",
      repositorySelection: "all",
      repositoryCount: null,
      suspended: false,
      uninstallUrl:
        "https://github.com/organizations/acme/settings/installations/555",
    },
  ],
  installUrl: "/api/github/install?organizationId=org-1",
};

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IntegrationsSettings />
    </ChakraProvider>,
  );
}

describe("<IntegrationsSettings/>", () => {
  afterEach(() => {
    mockRouterQuery.current = {};
    connectionStatus.current = {
      configured: true,
      connected: false,
      installations: [],
      installUrl: "/api/github/install?organizationId=org-1",
    };
    routerReplace.mockClear();
    vi.mocked(toaster.create).mockClear();
    cleanup();
  });

  describe("when GitHub redirects back with a githubError", () => {
    it("surfaces the failure as a toast", () => {
      mockRouterQuery.current = {
        githubError: "Installation link already used",
      };

      renderPage();

      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          description: "Installation link already used",
        }),
      );
    });

    it("strips githubError from the URL without scrolling away from the GitHub card", () => {
      mockRouterQuery.current = {
        githubError: "Installation link already used",
      };

      renderPage();

      expect(routerReplace).toHaveBeenCalledWith(
        {
          pathname: "/settings/integrations",
          query: {},
        },
        undefined,
        { shallow: true, scroll: false },
      );
    });

    it("does not repeat the toast once the URL cleanup has landed", () => {
      mockRouterQuery.current = {
        githubError: "Installation link already used",
      };

      const { rerender } = renderPage();
      expect(toaster.create).toHaveBeenCalledTimes(1);

      // The mocked replace() above already applied the cleaned query to
      // mockRouterQuery.current; rerender to pick it up, as a real
      // navigation would re-render this page with the new URL.
      rerender(
        <ChakraProvider value={defaultSystem}>
          <IntegrationsSettings />
        </ChakraProvider>,
      );

      expect(toaster.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("when there is no githubError", () => {
    it("does not show a toast", () => {
      renderPage();

      expect(toaster.create).not.toHaveBeenCalled();
    });
  });

  describe("when the instance has no GitHub App configured", () => {
    /** @scenario "App not configured on the instance hides the feature" */
    it("says the integration is unavailable instead of offering a connect button", () => {
      connectionStatus.current = {
        ...connectionStatus.current,
        configured: false,
      };

      const { queryByText } = renderPage();

      expect(queryByText(/not available on this instance/i)).toBeTruthy();
      expect(queryByText("Connect GitHub")).toBeNull();
    });
  });

  describe("when an installation is recorded", () => {
    /** @scenario "Disconnect points the admin at GitHub's uninstall page" */
    it("links to GitHub's own uninstall page for the account", () => {
      connectionStatus.current = { ...CONNECTED_STATUS };

      const { getByText } = renderPage();

      expect(getByText("Configure").getAttribute("href")).toBe(
        "https://github.com/organizations/acme/settings/installations/555",
      );
      expect(getByText("Disconnect")).toBeTruthy();
    });
  });
});
