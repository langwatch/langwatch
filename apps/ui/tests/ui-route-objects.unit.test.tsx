import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { UiRouteDescriptor } from "../src/model/ui-route-table";
import { createUiRouteObjects } from "../src/ui/sections/ui-route-objects";

const loaders = {
  "pages/home": async () => ({ default: () => <div>home page</div> }),
  "layouts/shell": async () => ({
    default: () => <div>shell</div>,
  }),
  "pages/nested": async () => ({ default: () => <div>nested page</div> }),
};

describe("given route descriptors and the loaders installed for them", () => {
  describe("when a page descriptor is materialised", () => {
    it("routes the path to the module the registered loader resolves", async () => {
      const routes = createUiRouteObjects({
        table: [{ path: "/home", page: "pages/home" }],
        loaders,
      });
      const router = createMemoryRouter(routes, { initialEntries: ["/home"] });

      render(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(document.body.textContent).toContain("home page");
      });
    });
  });

  describe("when a layout descriptor carries children", () => {
    it("keeps the child under the pathless parent", () => {
      const table: readonly UiRouteDescriptor[] = [
        { page: "layouts/shell", children: [{ path: "/nested", page: "pages/nested" }] },
      ];

      const [layout] = createUiRouteObjects({ table, loaders });

      expect(layout?.path).toBeUndefined();
      expect(layout?.children).toHaveLength(1);
      expect(layout?.children?.[0]?.path).toBe("/nested");
    });
  });

  describe("when a redirect descriptor is materialised", () => {
    it("forwards the whole prefix and pins the params it names", async () => {
      const routes = createUiRouteObjects({
        table: [
          { path: "/old/*", redirect: { from: "/old", to: "/new", pinParams: { tab: "one" } } },
          { path: "/new/deep", page: "pages/home" },
        ],
        loaders,
      });
      const router = createMemoryRouter(routes, { initialEntries: ["/old/deep?tab=stale"] });

      render(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/new/deep");
      });
      expect(router.state.location.search).toBe("?tab=one");
    });
  });

  describe("when the install list is missing a key the table names", () => {
    it("refuses to build the routes rather than failing on the navigation", () => {
      expect(() =>
        createUiRouteObjects({ table: [{ path: "/home", page: "pages/absent" }], loaders }),
      ).toThrow('No page loader is registered for route page "pages/absent".');
    });
  });
});
