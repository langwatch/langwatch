/**
 * @vitest-environment jsdom
 *
 * The navigation-v2 write points: product memory follows the pathname the
 * host reports, and entering Settings captures the page left so the back
 * entry can return there.
 *
 * MOVED from `platform/app/src/features/navigation/__tests__/useNavigationV2Tracking.integration.test.tsx`,
 * which drove a real memory router. That router is gone: this hook reads the
 * pathname off the navigation host, not off react-router, so a stub host
 * rerendered with a new pathname exercises the same write points.
 *
 * Spec: specs/navigation/navigation-v2-product-memory.feature
 */

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { NavigationHostProvider } from "../../model/navigation-host";
import { readLastVisitedProduct } from "../../model/product-memory";
import { resolveSettingsBackTarget } from "../../model/resolve-settings-back-target";
import { StubNavigationHost } from "../../testing";
import { useNavigationTracking } from "../use-navigation-tracking";

const ORGANIZATION = { id: "org_1", name: "Acme", teams: [] };

// `renderHook`'s `wrapper` re-renders on every `rerender()` call but is
// never handed the new props itself, so the pathname a scenario is
// currently "on" travels through this mutable binding instead.
let mockPathname = "/";

function wrapperFor({ children }: { children: ReactNode }) {
  return (
    <NavigationHostProvider
      value={StubNavigationHost.create({
        organization: ORGANIZATION,
        organizations: [ORGANIZATION],
        pathname: mockPathname,
      })}
    >
      {children}
    </NavigationHostProvider>
  );
}

function renderTrackingAt(pathname: string) {
  mockPathname = pathname;
  return renderHook(() => useNavigationTracking(), { wrapper: wrapperFor });
}

function navigateTo(rerender: (props?: unknown) => void, pathname: string) {
  mockPathname = pathname;
  rerender();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("useNavigationTracking", () => {
  describe("when navigating between products in a new mode", () => {
    /** @scenario Navigating the app keeps the memory current */
    it("keeps the per-organization product memory current", () => {
      const { rerender } = renderTrackingAt("/gateway/virtual-keys");
      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe("gateway");

      navigateTo(rerender, "/governance/departments");
      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe("governance");
    });
  });

  describe("when entering settings from a product page", () => {
    /** @scenario Entering Settings captures where I came from */
    it("captures the page left so the back entry returns there", () => {
      const { rerender } = renderTrackingAt("/gateway/budgets");

      navigateTo(rerender, "/settings/members");

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
    it("keeps the first capture when hopping between settings pages", () => {
      const { rerender } = renderTrackingAt("/gateway/budgets");

      navigateTo(rerender, "/settings/members");
      navigateTo(rerender, "/settings/api-keys");

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: null,
          reachableProducts: [],
          projectSlug: null,
        }),
      ).toEqual({ label: "Back to Gateway", href: "/gateway/budgets" });
    });
  });
});
