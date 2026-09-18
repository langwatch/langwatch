/**
 * @vitest-environment jsdom
 *
 * The navigation-v2 write points against a real memory router: product
 * memory follows navigation, settings entry captures the page left, and
 * legacy mode writes nothing at all.
 *
 * Spec: specs/navigation/navigation-v2-product-memory.feature
 */

import { act, render } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockMode: "legacy" | "product-switcher" = "product-switcher";

vi.mock("../useNavigationMode", () => ({
  useNavigationMode: () => ({ status: "ready", mode: mockMode }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_1" },
    isLoading: false,
  }),
}));

import { readLastVisitedProduct } from "../logic/productMemory";
import { resolveSettingsBackTarget } from "../logic/resolveSettingsBackTarget";
import { useNavigationV2Tracking } from "../useNavigationV2Tracking";

function TrackingHost() {
  useNavigationV2Tracking();
  return <Outlet />;
}

function renderRouterAt(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        element: <TrackingHost />,
        children: [{ path: "*", element: <div /> }],
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockMode = "product-switcher";
});

describe("useNavigationV2Tracking", () => {
  describe("when navigating between products in a new mode", () => {
    /** @scenario Navigating the app keeps the memory current */
    it("keeps the per-organization product memory current", async () => {
      const router = renderRouterAt("/gateway/virtual-keys");
      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe(
        "gateway",
      );

      await act(async () => {
        await router.navigate("/governance/departments");
      });
      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe(
        "governance",
      );
    });
  });

  describe("when entering settings from a product page", () => {
    /** @scenario Entering Settings captures where I came from */
    it("captures the page left so the back entry returns there", async () => {
      const router = renderRouterAt("/gateway/budgets");

      await act(async () => {
        await router.navigate("/settings/members");
      });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: null,
          reachableProducts: [],
          projectSlug: null,
        }),
      ).toEqual({ label: "Back to Gateway", href: "/gateway/budgets" });
    });

    /** @scenario Moving between settings pages keeps the captured page */
    it("keeps the first capture when hopping between settings pages", async () => {
      const router = renderRouterAt("/gateway/budgets");

      await act(async () => {
        await router.navigate("/settings/members");
      });
      await act(async () => {
        await router.navigate("/settings/api-keys");
      });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: null,
          reachableProducts: [],
          projectSlug: null,
        }),
      ).toEqual({ label: "Back to Gateway", href: "/gateway/budgets" });
    });

    /** @scenario The back entry drops a page from another organization */
    it("drops the capture after an organization switch", async () => {
      const router = renderRouterAt("/gateway/budgets");

      await act(async () => {
        await router.navigate("/settings/members");
      });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_2",
          rememberedProduct: null,
          reachableProducts: [],
          projectSlug: null,
        }),
      ).toEqual({ label: "Back", href: "/" });
    });
  });

  describe("when the device is in legacy mode", () => {
    /** @scenario Legacy mode writes no product memory */
    it("writes nothing", async () => {
      mockMode = "legacy";
      const router = renderRouterAt("/gateway/virtual-keys");

      await act(async () => {
        await router.navigate("/governance");
      });

      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBeNull();
      expect(sessionStorage.length).toBe(0);
    });
  });
});
