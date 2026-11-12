/**
 * @vitest-environment jsdom
 * Spec: modules/navigation/specs/navigation-v2-product-memory.feature
 */

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { writeDashboardsSidebarHint } from "../../model/dashboards-sidebar-hint.ts";
import { NavigationHostProvider } from "../../model/navigation-host.ts";
import { readLastVisitedProduct } from "../../model/product-memory.ts";
import { resolveSettingsBackTarget } from "../../model/resolve-settings-back-target.ts";
import { StubNavigationHost } from "../../testing.tsx";
import { useNavigationTracking } from "../use-navigation-tracking.ts";

const ORGANIZATION = { id: "org_1", name: "Acme", teams: [] };

// `renderHook`'s `wrapper` re-renders on every `rerender()` call but is
// never handed the new props itself, so the pathname a scenario is
// currently "on" travels through this mutable binding instead.
let mockPathname = "/";
let mockProject: { id: string; name: string; slug: string } | undefined;

function wrapperFor({ children }: { children: ReactNode }) {
  return (
    <NavigationHostProvider
      value={StubNavigationHost.create({
        organization: ORGANIZATION,
        organizations: [ORGANIZATION],
        pathname: mockPathname,
        project: mockProject,
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
  mockProject = undefined;
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

  describe("when a dashboard is opened from LLM Ops", () => {
    /** @scenario The remembered product is the sidebar drawn */
    it("remembers LLM Ops, the sidebar shown, not Dashboards", () => {
      const { rerender } = renderTrackingAt("/acme-app/messages");
      navigateTo(rerender, "/acme-app/dashboards/agent-flight-deck");

      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe("llm-ops");
    });

    /** @scenario A sidebar hint from another project is ignored */
    it("does not carry an LLM Ops hint into another project", () => {
      mockProject = { id: "proj_a", name: "A", slug: "a" };
      const { rerender } = renderTrackingAt("/a/messages");
      mockProject = { id: "proj_b", name: "B", slug: "b" };
      navigateTo(rerender, "/b/dashboards/agent-flight-deck");

      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe("dashboards");
    });

    /** @scenario Choosing Dashboards in the product switcher or icon rail draws the Dashboards sidebar */
    it("remembers Dashboards once the switcher chose it", () => {
      const { rerender } = renderTrackingAt("/acme-app/messages");
      writeDashboardsSidebarHint({ hint: "dashboards", projectId: undefined });
      navigateTo(rerender, "/acme-app/dashboards");

      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe("dashboards");
    });

    /** @scenario Leaving for Gateway resets the hint */
    it("resets the hint on a Gateway page", () => {
      const { rerender } = renderTrackingAt("/acme-app/messages");
      navigateTo(rerender, "/gateway/budgets");
      navigateTo(rerender, "/acme-app/dashboards");

      expect(readLastVisitedProduct({ organizationId: "org_1" })).toBe("dashboards");
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
