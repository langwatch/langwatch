/**
 * @vitest-environment jsdom
 *
 * Settings → Integrations shows the remembered answer to "how should Langy
 * reach my code" next to the GitHub connection, and clears it
 * (specs/langy/langy-code-access.feature). The choice is made in the chat, so
 * the line only exists once one is stored: a settings page that offers to
 * change a choice nobody made is noise.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const preference = vi.hoisted(() => ({
  current: null as "github" | null,
}));
const clearPreference = vi.hoisted(() => vi.fn());

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
    github: {
      getConnectionStatus: {
        useQuery: () => ({
          data: {
            configured: true,
            connected: true,
            installations: [
              {
                installationId: "i1",
                accountLogin: "acme",
                accountType: "Organization",
                repositorySelection: "all",
                repositoryCount: null,
                suspended: false,
                uninstallUrl: "https://github.test/uninstall",
              },
            ],
            installUrl: "/api/github/install?organizationId=org-1",
          },
          refetch: vi.fn(),
        }),
      },
      disconnect: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    langy: {
      getCodeAccessPreference: {
        useQuery: () => ({
          data: { preference: preference.current },
          refetch: vi.fn(),
        }),
      },
      setCodeAccessPreference: {
        useMutation: () => ({ mutate: clearPreference, isPending: false }),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme Corp" },
    project: { id: "p_1", slug: "acme" },
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

afterEach(cleanup);
beforeEach(() => clearPreference.mockClear());

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <IntegrationsSettings />
    </ChakraProvider>,
  );

describe("given GitHub was remembered for code changes", () => {
  beforeEach(() => {
    preference.current = "github";
  });

  /** @scenario "The remembered choice can be cleared from the integrations settings" */
  it("says so in the GitHub section, and clears the choice", () => {
    renderPage();

    expect(
      screen.getByText("Langy uses GitHub for code changes"),
    ).toBeDefined();
    fireEvent.click(screen.getByText("Change"));

    expect(clearPreference).toHaveBeenCalledWith({
      projectId: "p_1",
      preference: null,
    });
  });
});

describe("given nothing was remembered", () => {
  beforeEach(() => {
    preference.current = null;
  });

  it("says nothing, because there is no choice to change", () => {
    renderPage();
    expect(screen.queryByText("Langy uses GitHub for code changes")).toBeNull();
  });
});
