/**
 * The personal workspace moved from /me/* to /coding-agents/*.
 * @vitest-environment jsdom
 * Spec: specs/navigation/coding-agents-url-move.feature
 */

import { createUiRouteObjects } from "@langwatch/browser/route-objects";
import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, type RouteObject, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { uiLegacyRedirectRoutes } from "../ui-route-table";

/** The redirect descriptors the application mounts, materialised the same way. */
const legacyRedirectRoutes = createUiRouteObjects({
  table: uiLegacyRedirectRoutes,
  loaders: {},
});

function renderRouterAt(initialEntries: string[]) {
  const routes: RouteObject[] = [
    { path: "/start", element: <div>start</div> },
    ...legacyRedirectRoutes,
    { path: "/coding-agents", element: <div>coding agents home</div> },
    { path: "/coding-agents/configure", element: <div>configure</div> },
    { path: "/coding-agents/sessions", element: <div>sessions</div> },
    { path: "/coding-agents/pull-requests", element: <div>pull requests</div> },
    // The project pages that outrank a /me/* prefix row, so the old
    // addresses are ranked against what the application also serves.
    { path: "/:project/sessions", element: <div>project sessions</div> },
    { path: "/:project/pull-requests", element: <div>project pull requests</div> },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries,
    initialIndex: initialEntries.length - 1,
  });
  render(<RouterProvider router={router} />);
  return router;
}

function addressOf(router: ReturnType<typeof renderRouterAt>): string {
  const { pathname, search, hash } = router.state.location;
  return `${pathname}${search}${hash}`;
}

describe("legacy /me redirects", () => {
  describe("when the bare old address is cold-loaded", () => {
    /** @scenario The bare old address lands on the Coding agents home */
    it("lands on the Coding agents home", async () => {
      const router = renderRouterAt(["/me"]);

      await waitFor(() => {
        expect(addressOf(router)).toBe("/coding-agents");
      });
    });
  });

  describe("when an old deep link is cold-loaded", () => {
    /** @scenario An old deep link keeps its sub-path, query and hash */
    it("lands on the new address with sub-path, query and hash intact", async () => {
      const router = renderRouterAt(["/start", "/me/sessions?range=7d#latest"]);

      await waitFor(() => {
        expect(addressOf(router)).toBe("/coding-agents/sessions?range=7d#latest");
      });
    });

    /** @scenario An old deep link keeps its sub-path, query and hash */
    it("replaces the history entry so back skips the old address", async () => {
      const router = renderRouterAt(["/start", "/me/sessions"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/coding-agents/sessions");
      });

      await act(async () => {
        await router.navigate(-1);
      });
      expect(router.state.location.pathname).toBe("/start");
    });
  });

  describe("when an old address a project page also matches is cold-loaded", () => {
    /** @scenario An old address that a project page also matches still moves */
    it.each([
      ["/me/pull-requests", "/coding-agents/pull-requests"],
      ["/me/sessions", "/coding-agents/sessions"],
    ])("moves %s to %s instead of opening a project named me", async (from, to) => {
      const router = renderRouterAt([from]);

      await waitFor(() => {
        expect(addressOf(router)).toBe(to);
      });
    });
  });

  describe("when the old devices address is cold-loaded", () => {
    /** @scenario The old devices address lands on the devices tab */
    it("lands on configure with the devices tab pinned", async () => {
      const router = renderRouterAt(["/me/devices?tab=keys"]);

      await waitFor(() => {
        expect(addressOf(router)).toBe("/coding-agents/configure?tab=devices");
      });
    });
  });
});
