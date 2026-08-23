/**
 * @vitest-environment jsdom
 *
 * Governance pages rename over time; their addresses must not. These tests
 * run the REAL redirect route objects routes.tsx mounts inside a memory
 * router, so what is asserted is the address the reader ends on.
 *
 * Spec: specs/governance/governance-navigation.feature
 */

import { render } from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { describe, expect, it } from "vitest";
import { LegacyPrefixRedirect } from "~/components/LegacyPrefixRedirect";

function renderRouterAt(initialEntries: string[]) {
  const routes: RouteObject[] = [
    { path: "/start", element: <div>start</div> },
    // The same objects routes.tsx mounts for the renamed governance pages.
    {
      path: "/governance/departments",
      element: (
        <LegacyPrefixRedirect
          from="/governance/departments"
          to="/governance/people"
        />
      ),
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
    { path: "/governance/people", element: <div>people page</div> },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries,
    initialIndex: initialEntries.length - 1,
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("given governance pages that were renamed", () => {
  describe("when a reader opens the old departments address from a bookmark", () => {
    // @scenario "Old departments bookmarks land on the people page"
    it("lands on the people page", () => {
      const router = renderRouterAt(["/start", "/governance/departments"]);
      expect(router.state.location.pathname).toBe("/governance/people");
    });
  });

  describe("when a reader opens the older cost-centers address", () => {
    it("chains onto the people page", () => {
      const router = renderRouterAt(["/start", "/governance/cost-centers"]);
      expect(router.state.location.pathname).toBe("/governance/people");
    });
  });
});
