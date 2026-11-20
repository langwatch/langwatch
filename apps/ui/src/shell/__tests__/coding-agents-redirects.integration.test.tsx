/**
 * The personal workspace moved from /me/* to /coding-agents/*.
 * @vitest-environment jsdom
 * Spec: specs/navigation/coding-agents-url-move.feature
 */

import { uiRoutePageKeys, type UiPageLoaderRegistry } from "@langwatch/browser/feature-install";
import { createUiRouteObjects } from "@langwatch/browser/route-objects";
import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, type RouteObject, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { uiRoutePatterns } from "../route-patterns";
import { uiCodingAgentsRedirectRoutes, uiMountedRouteTable } from "../ui-route-table";

/** The redirect descriptors the application mounts, materialised the same way. */
const legacyRedirectRoutes = createUiRouteObjects({
  table: uiCodingAgentsRedirectRoutes,
  loaders: {},
});

const passThrough = async () => ({ default: () => <Outlet /> });

const stubbedPages: UiPageLoaderRegistry = Object.fromEntries(
  uiRoutePageKeys(uiMountedRouteTable).map((key) => [key, passThrough]),
);

/**
 * The real table under a chrome still waiting for a project: the real chrome holds its
 * page back then, so a redirect mounted beneath it never runs.
 */
const waitingChromeRoutes = createUiRouteObjects({
  table: uiMountedRouteTable,
  loaders: stubbedPages,
  shellLayouts: {
    auth: passThrough,
    chrome: async () => ({ default: () => null }),
    "full-screen": passThrough,
  },
});

/** The real table's routes are lazy; their first resolve can outlast waitFor's 1s default. */
const LAZY_TABLE = { timeout: 5000 };

function renderRouterAt(initialEntries: string[]) {
  const routes: RouteObject[] = [
    { path: "/start", element: <div>start</div> },
    ...legacyRedirectRoutes,
    { path: "/coding-agents", element: <div>coding agents home</div> },
    { path: "/coding-agents/configure", element: <div>configure</div> },
    { path: "/coding-agents/sessions", element: <div>sessions</div> },
    { path: "/coding-agents/pull-requests", element: <div>pull requests</div> },
    { path: "/coding-agents/budget/request", element: <div>budget request</div> },
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

/** Every `/:project/<segment>` the application serves: the table's own and the modules'. */
const projectSegments = [
  ...new Set(
    uiRoutePatterns().flatMap((pattern) => pattern.match(/^\/:project\/([^/:*]+)/)?.[1] ?? []),
  ),
];

/** The segments with a page of their own under /coding-agents: read off the same patterns. */
const codingAgentsSegments = new Set(
  uiRoutePatterns().flatMap((pattern) => pattern.match(/^\/coding-agents\/([^/:*]+)$/)?.[1] ?? []),
);

/**
 * Every deep project page, table's and modules' alike, as an old /me address: each one
 * outranks the `/me/<segment>/*` row unless it has a twin of its own.
 */
const deepProjectAddresses = [
  ...new Set(
    uiRoutePatterns()
      .filter((pattern) => /^\/:project\/[^/]+\/./.test(pattern))
      .map((pattern) =>
        pattern
          .replace(":project", "me")
          .replace(/:[^/]+/g, "sample")
          .replace(/\*$/, "sample"),
      ),
  ),
];

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

  describe("when an old address names any page the project routes serve", () => {
    /** @scenario Every old address a project page also matches lands on Coding agents */
    it.each(projectSegments)("moves /me/%s instead of opening a project", async (segment) => {
      const projectPages: RouteObject[] = uiRoutePatterns()
        .filter((pattern) => pattern.startsWith("/:project/"))
        .map((path) => ({ path, element: <div>project page</div> }));
      const router = createMemoryRouter(
        [
          ...legacyRedirectRoutes,
          ...projectPages,
          { path: "/coding-agents/*", element: <div>coding agents</div> },
        ],
        { initialEntries: [`/me/${segment}`] },
      );
      render(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(addressOf(router)).toBe(
          codingAgentsSegments.has(segment) ? `/coding-agents/${segment}` : "/coding-agents",
        );
      });
    });

    /** @scenario Every old address a project page also matches lands on Coding agents */
    it("drops the sub-path of a segment with no Coding agents page", async () => {
      const router = renderRouterAt(["/me/traces/abc?range=7d"]);

      await waitFor(() => {
        expect(addressOf(router)).toBe("/coding-agents?range=7d");
      });
    });
  });

  describe("when a deep old address meets the real project routes", () => {
    /** @scenario Every old address a project page also matches lands on Coding agents */
    it.each(deepProjectAddresses)(
      "moves %s to the Coding agents home, not a project page",
      async (from) => {
        const projectPages: RouteObject[] = uiRoutePatterns()
          .filter((pattern) => pattern.startsWith("/:project/"))
          .map((path) => ({ path, element: <div>project page</div> }));
        const router = createMemoryRouter(
          [
            ...legacyRedirectRoutes,
            ...projectPages,
            { path: "/coding-agents/*", element: <div>coding agents</div> },
          ],
          { initialEntries: [from] },
        );
        render(<RouterProvider router={router} />);

        await waitFor(() => {
          expect(addressOf(router)).toBe("/coding-agents");
        });
      },
    );
  });

  describe("when the old budget request address is cold-loaded", () => {
    /** @scenario An old deep link keeps its sub-path, query and hash */
    it("keeps its nested page", async () => {
      const router = renderRouterAt(["/me/budget/request"]);

      await waitFor(() => {
        expect(addressOf(router)).toBe("/coding-agents/budget/request");
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

  describe("when an old address for one device is cold-loaded", () => {
    /** @scenario The old devices address lands on the devices tab */
    it("lands on configure with the devices tab pinned", async () => {
      const router = renderRouterAt(["/me/devices/dev_123"]);

      await waitFor(() => {
        expect(addressOf(router)).toBe("/coding-agents/configure?tab=devices");
      });
    });
  });

  describe("when the chrome is still waiting for a project", () => {
    /** @scenario An old address moves before the workspace has picked a project */
    it("moves the old address anyway", async () => {
      const router = createMemoryRouter(waitingChromeRoutes, {
        initialEntries: ["/me/configure?tab=devices#inventory"],
      });
      render(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(addressOf(router)).toBe("/coding-agents/configure?tab=devices#inventory");
      }, LAZY_TABLE);
    });
  });
});
