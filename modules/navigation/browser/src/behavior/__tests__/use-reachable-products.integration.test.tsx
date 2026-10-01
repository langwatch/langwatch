/**
 * @vitest-environment jsdom
 * Stable array identity for reachable products; moved from platform/app to use stub host
 */

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { NavigationHostProvider } from "../../model/navigation-host.ts";
import { StubNavigationHost } from "../../testing.tsx";
import { useReachableProducts } from "../use-reachable-products.ts";

const ORGANIZATION = { id: "org_1", name: "Acme", teams: [] };
const ON = { enabled: true, isLoading: false };

function hostWithEveryFlagOn() {
  return StubNavigationHost.create({
    organization: ORGANIZATION,
    organizations: [ORGANIZATION],
    permissions: ["virtualKeys:view", "governance:view"],
    flags: {
      release_ui_ai_gateway_menu_enabled: ON,
      release_ui_ai_governance_enabled: ON,
    },
  });
}

function wrapperFor(host: StubNavigationHost) {
  return ({ children }: { children: ReactNode }) => (
    <NavigationHostProvider value={host}>{children}</NavigationHostProvider>
  );
}

describe("useReachableProducts", () => {
  describe("when nothing changes between renders", () => {
    it("returns the same array identity", () => {
      const { result, rerender } = renderHook(() => useReachableProducts(), {
        wrapper: wrapperFor(hostWithEveryFlagOn()),
      });
      const first = result.current.reachableProducts;

      rerender();

      expect(result.current.reachableProducts).toBe(first);
      expect(first).toEqual(["me", "llm-ops", "gateway", "governance"]);
    });
  });

  describe("when the caller disables the hook", () => {
    it("asks for no product flag at all", () => {
      const host = hostWithEveryFlagOn();
      const featureFlag = vi.spyOn(host, "featureFlag");

      const { result } = renderHook(() => useReachableProducts({ enabled: false }), {
        wrapper: wrapperFor(host),
      });

      expect(result.current.reachableProducts).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(featureFlag).not.toHaveBeenCalled();
    });
  });
});
