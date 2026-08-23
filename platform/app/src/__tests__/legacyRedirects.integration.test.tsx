/**
 * @vitest-environment jsdom
 *
 * The gateway moved from /settings/gateway/* to /gateway/*. These tests run
 * the REAL redirect route objects that routes.tsx mounts (legacyRedirectRoutes)
 * plus the real /gateway index page, inside a memory router, so what is
 * asserted is the address the user ends on: sub-path, query and hash intact,
 * history entry replaced.
 *
 * Spec: specs/navigation/gateway-url-move.feature
 */

import { act, render, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { describe, expect, it, vi } from "vitest";
import { LegacyPrefixRedirect } from "../components/LegacyPrefixRedirect";
import { legacyRedirectRoutes } from "../legacyRedirects";

// The global test-setup.ts stubs ~/utils/compat/next-router with an inert
// router. The gateway index page redirects through the real compat layer,
// and the redirect is exactly what is under test here.
vi.unmock("~/utils/compat/next-router");
vi.mock(
  "~/utils/compat/next-router",
  async () => await vi.importActual<object>("~/utils/compat/next-router"),
);

vi.mock("~/components/gateway/AiGatewayLayout", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (component: React.ComponentType) => component,
}));

import GatewayIndexPage from "../pages/gateway/index";

function renderRouterAt(initialEntries: string[]) {
  const routes: RouteObject[] = [
    { path: "/start", element: <div>start</div> },
    ...legacyRedirectRoutes,
    { path: "/gateway", Component: GatewayIndexPage },
    { path: "/gateway/virtual-keys", element: <div>virtual keys page</div> },
    {
      path: "/gateway/virtual-keys/:id",
      element: <div>virtual key detail</div>,
    },
    { path: "/governance", element: <div>governance home</div> },
    { path: "/governance/teams/:id", element: <div>team detail</div> },
    {
      path: "/gateway/routing-policies",
      element: <div>routing policies</div>,
    },
    {
      path: "/governance/cost-centers",
      element: (
        <LegacyPrefixRedirect
          from="/governance/cost-centers"
          to="/governance/people"
        />
      ),
    },
    { path: "/governance/people", element: <div>people</div> },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries,
    initialIndex: initialEntries.length - 1,
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("legacy gateway redirects", () => {
  describe("when an old deep link is cold-loaded", () => {
    /** @scenario An old gateway deep link lands on the same page at its new address */
    it("lands on the new address with sub-path, query and hash intact", async () => {
      const router = renderRouterAt([
        "/start",
        "/settings/gateway/virtual-keys/vk_123?tab=usage#limits",
      ]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(
          "/gateway/virtual-keys/vk_123",
        );
      });
      expect(router.state.location.search).toBe("?tab=usage");
      expect(router.state.location.hash).toBe("#limits");
    });

    /** @scenario An old gateway deep link lands on the same page at its new address */
    it("replaces the history entry so back skips the old address", async () => {
      const router = renderRouterAt([
        "/start",
        "/settings/gateway/virtual-keys/vk_123",
      ]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(
          "/gateway/virtual-keys/vk_123",
        );
      });

      await act(async () => {
        await router.navigate(-1);
      });
      expect(router.state.location.pathname).toBe("/start");
    });
  });

  describe("when the bare old address is cold-loaded", () => {
    /** @scenario The bare old gateway address lands on the virtual keys list */
    it("chains through the gateway index to the virtual keys list", async () => {
      const router = renderRouterAt(["/settings/gateway"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/gateway/virtual-keys");
      });
    });
  });

  describe("when the bare new address is opened", () => {
    /** @scenario The bare gateway address lands on the virtual keys list */
    it("lands on the virtual keys list", async () => {
      const router = renderRouterAt(["/gateway"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/gateway/virtual-keys");
      });
    });
  });

  describe("when the canonical address is opened", () => {
    /** @scenario The canonical gateway address renders the gateway */
    it("stays on the canonical address with no redirect", async () => {
      const router = renderRouterAt(["/gateway/virtual-keys"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/gateway/virtual-keys");
      });
      expect(router.state.location.search).toBe("");
    });
  });
});

describe("legacy governance redirects", () => {
  describe("when an old governance deep link is cold-loaded", () => {
    /** @scenario An old governance deep link lands on the same page at its new address */
    it("lands on the new address with sub-path and query intact", async () => {
      const router = renderRouterAt([
        "/settings/governance/teams/team_123?range=30d",
      ]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(
          "/governance/teams/team_123",
        );
      });
      expect(router.state.location.search).toBe("?range=30d");
    });
  });

  describe("when the old routing policies address is cold-loaded", () => {
    /** @scenario Routing policies join the gateway */
    it("lands on the gateway routing policies page", async () => {
      const router = renderRouterAt(["/settings/routing-policies"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(
          "/gateway/routing-policies",
        );
      });
    });

    /** @scenario Routing policies join the gateway */
    it("keeps the query and hash on the way over", async () => {
      const router = renderRouterAt([
        "/settings/routing-policies?scope=team#policy_1",
      ]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(
          "/gateway/routing-policies",
        );
      });
      expect(router.state.location.search).toBe("?scope=team");
      expect(router.state.location.hash).toBe("#policy_1");
    });
  });

  describe("when the retired cost centers address is cold-loaded", () => {
    /** @scenario The retired cost centers address lands on people */
    it("chains through to the people page", async () => {
      const router = renderRouterAt(["/settings/governance/cost-centers"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/people");
      });
    });
  });
});
