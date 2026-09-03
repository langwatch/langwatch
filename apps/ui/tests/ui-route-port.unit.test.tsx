/**
 * @vitest-environment jsdom
 *
 * The address a screen reads, over the router it may not import.
 *
 * Two properties matter and neither is obvious from the type: a repeated query
 * key collapses to one value rather than reaching a screen as an array it never
 * writes, and `setQuery` replaces the whole query rather than merging, so a
 * screen can remove a key it put there.
 */

import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { UiRoutePort } from "../src/behavior/ui-capabilities";
import { useRouterUiRoute } from "../src/behavior/ui-router-navigation";

function readRouteAt(url: string): { port: UiRoutePort; search: () => string } {
  let port: UiRoutePort | undefined;

  function Probe() {
    port = useRouterUiRoute();
    return null;
  }

  const router = createMemoryRouter([{ path: "/governance/inventory/:id", element: <Probe /> }], {
    initialEntries: [url],
  });
  render(<RouterProvider router={router} />);

  return {
    port: port!,
    search: () => router.state.location.search,
  };
}

describe("given a screen asking where it is", () => {
  describe("when the address carries a path parameter and a query", () => {
    it("hands back both, separately", () => {
      const { port } = readRouteAt("/governance/inventory/src_9?tab=sources");

      expect(port.reading()).toEqual({
        params: { id: "src_9" },
        query: { tab: "sources" },
      });
    });
  });

  describe("when a query key is repeated", () => {
    it("keeps the last value rather than an array", () => {
      const { port } = readRouteAt("/governance/inventory/src_9?tab=sources&tab=catalog");

      expect(port.reading().query).toEqual({ tab: "catalog" });
    });
  });

  describe("when the screen writes the query", () => {
    it("removes a key it left out, rather than merging over it", () => {
      const { port, search } = readRouteAt("/governance/inventory/src_9?tab=sources&page=3");

      port.setQuery({ page: "4" }, { replace: true });

      expect(search()).toBe("?page=4");
    });
  });
});
