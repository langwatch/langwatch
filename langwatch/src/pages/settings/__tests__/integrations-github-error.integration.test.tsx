/**
 * @vitest-environment jsdom
 *
 * Covers the "Setup callback rejects a tampered or expired state" scenario
 * from specs/langy/langy-github-install.feature: "I am shown that the
 * installation could not be verified".
 *
 * The `/setup` callback (src/server/routes/github-langy.ts) reports every
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
const routerReplace = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockRouterQuery.current,
    pathname: "/settings/integrations",
    push: vi.fn(),
    replace: routerReplace,
    isReady: true,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    langyGithub: {
      getInstallStatus: {
        useQuery: () => ({
          data: { configured: true, installations: [] },
        }),
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

    it("strips githubError from the URL so a refresh doesn't re-show it", () => {
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
        { shallow: true },
      );
    });
  });

  describe("when there is no githubError", () => {
    it("does not show a toast", () => {
      renderPage();

      expect(toaster.create).not.toHaveBeenCalled();
    });
  });
});
