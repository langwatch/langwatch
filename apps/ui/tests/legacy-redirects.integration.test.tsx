/**
 * @vitest-environment jsdom
 *
 * The gateway moved from /settings/gateway/* to /gateway/*. These tests run the
 * REAL redirect descriptors the packaged route table mounts
 * (`uiLegacyRedirectRoutes`) plus the table's own `/gateway` row, materialised
 * through the same function the application uses, inside a memory router, so
 * what is asserted is the address the user ends on: sub-path, query and hash
 * intact, history entry replaced.
 *
 * It lives here rather than in `platform/app` because every descriptor it
 * exercises is this package's. The bare `/gateway` row is why it moved when it
 * did: it was a page component whose whole body was a `router.replace`, and it
 * is a redirect row now, so there is no page left in `platform/app` to import.
 *
 * Spec: specs/navigation/gateway-url-move.feature
 */

import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, type RouteObject, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { createUiRouteObjects } from "../src/ui/sections/ui-route-objects";
import {
  uiLegacyRedirectRoutes,
  uiRouteDescriptors,
  uiRouteTable,
} from "../src/model/ui-route-table";
import { UiPrefixRedirect } from "../src/ui/elements/ui-prefix-redirect";

/** The redirect descriptors the application mounts, materialised the same way. */
const legacyRedirectRoutes = createUiRouteObjects({
  table: uiLegacyRedirectRoutes,
  loaders: {},
});

/**
 * The table's own `/gateway` row, taken from the table rather than restated.
 * A row retargeted somewhere else has to fail here, which restating it would
 * hide.
 */
const gatewayHomeRoute = createUiRouteObjects({
  table: uiRouteDescriptors(uiRouteTable).filter((descriptor) => descriptor.path === "/gateway"),
  loaders: {},
});

function renderRouterAt(initialEntries: string[]) {
  const routes: RouteObject[] = [
    { path: "/start", element: <div>start</div> },
    ...legacyRedirectRoutes,
    ...gatewayHomeRoute,
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
      // Mirrors the route table's stanza: retargeted straight to People so
      // the departments rename never adds a hop.
      path: "/governance/cost-centers",
      element: <UiPrefixRedirect from="/governance/cost-centers" to="/governance/people" />,
    },
    { path: "/governance/people", element: <div>people</div> },
    { path: "/governance/inventory", element: <div>inventory page</div> },
    {
      path: "/governance/inventory/:id",
      element: <div>inventory detail</div>,
    },
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
        expect(router.state.location.pathname).toBe("/gateway/virtual-keys/vk_123");
      });
      expect(router.state.location.search).toBe("?tab=usage");
      expect(router.state.location.hash).toBe("#limits");
    });

    /** @scenario An old gateway deep link lands on the same page at its new address */
    it("replaces the history entry so back skips the old address", async () => {
      const router = renderRouterAt(["/start", "/settings/gateway/virtual-keys/vk_123"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/gateway/virtual-keys/vk_123");
      });

      await act(async () => {
        await router.navigate(-1);
      });
      expect(router.state.location.pathname).toBe("/start");
    });
  });

  describe("when the bare old address is cold-loaded", () => {
    /** @scenario The bare old gateway address lands on the virtual keys list */
    it("chains through the bare gateway address to the virtual keys list", async () => {
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
      const router = renderRouterAt(["/settings/governance/teams/team_123?range=30d"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/teams/team_123");
      });
      expect(router.state.location.search).toBe("?range=30d");
    });
  });

  describe("when the old routing policies address is cold-loaded", () => {
    /** @scenario Routing policies join the gateway */
    it("lands on the gateway routing policies page", async () => {
      const router = renderRouterAt(["/settings/routing-policies"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/gateway/routing-policies");
      });
    });

    /** @scenario Routing policies join the gateway */
    it("keeps the query and hash on the way over", async () => {
      const router = renderRouterAt(["/settings/routing-policies?scope=team#policy_1"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/gateway/routing-policies");
      });
      expect(router.state.location.search).toBe("?scope=team");
      expect(router.state.location.hash).toBe("#policy_1");
    });
  });

  describe("when the retired ingestion sources address is cold-loaded", () => {
    /** @scenario The retired ingestion sources address lands on the inventory Sources tab */
    it("lands on the inventory Sources tab and replaces the history entry", async () => {
      const router = renderRouterAt(["/start", "/governance/ingestion-sources"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/inventory");
      });
      expect(router.state.location.search).toBe("?tab=sources");

      await act(async () => {
        await router.navigate(-1);
      });
      expect(router.state.location.pathname).toBe("/start");
    });

    /** @scenario A stale tab value on a retired sources address still lands on Sources */
    it("overrides a stale tab value instead of carrying it to a different pane", async () => {
      const router = renderRouterAt(["/governance/ingestion-sources?tab=catalog"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/inventory");
      });
      expect(router.state.location.search).toBe("?tab=sources");
    });

    /** @scenario An old ingestion source deep link lands on the inventory detail page */
    it("lands on the inventory detail page with the query intact", async () => {
      const router = renderRouterAt(["/governance/ingestion-sources/src_123?range=30d"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/inventory/src_123");
      });
      expect(router.state.location.search).toBe("?range=30d");
    });
  });

  describe("when the retired catalog address is cold-loaded", () => {
    /** @scenario The retired catalog address keeps meaning the sources surface */
    it("lands on the inventory Sources tab, not the new default tab", async () => {
      const router = renderRouterAt(["/governance/catalog"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/inventory");
      });
      expect(router.state.location.search).toBe("?tab=sources");
    });

    /** @scenario The retired catalog address keeps meaning the sources surface */
    it("keeps an existing query while pinning the sources tab", async () => {
      const router = renderRouterAt(["/governance/catalog?range=30d"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/inventory");
      });
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get("tab")).toBe("sources");
      expect(params.get("range")).toBe("30d");
    });

    /** @scenario A stale tab value on a retired sources address still lands on Sources */
    it("overrides a stale tab value instead of carrying it to a different pane", async () => {
      const router = renderRouterAt(["/governance/catalog?tab=catalog"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/inventory");
      });
      expect(router.state.location.search).toBe("?tab=sources");
    });

    /** @scenario An old catalog detail deep link lands on the inventory detail page */
    it("lands on the inventory detail page with the query intact", async () => {
      const router = renderRouterAt(["/governance/catalog/src_123?range=30d"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/inventory/src_123");
      });
      expect(router.state.location.search).toBe("?range=30d");
    });
  });

  describe("when the retired tool-catalog address is cold-loaded", () => {
    /** @scenario The retired tool-catalog address lands on the inventory page */
    it("lands on the bare inventory address", async () => {
      const router = renderRouterAt(["/governance/tool-catalog"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/inventory");
      });
      expect(router.state.location.search).toBe("");
    });
  });

  describe("when the retired departments address is cold-loaded", () => {
    /** @scenario The retired departments address lands on People */
    it("lands on the people page", async () => {
      const router = renderRouterAt(["/governance/departments"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/people");
      });
    });
  });

  describe("when the retired cost centers address is cold-loaded", () => {
    /** @scenario The cost-centers redirect is retargeted to People in one hop */
    it("lands on the people page without chaining through departments", async () => {
      const router = renderRouterAt(["/governance/cost-centers"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/people");
      });
    });

    /** @scenario The retired cost centers address lands on People */
    it("lands on the people page from the legacy settings prefix too", async () => {
      const router = renderRouterAt(["/settings/governance/cost-centers"]);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/governance/people");
      });
    });
  });
});
