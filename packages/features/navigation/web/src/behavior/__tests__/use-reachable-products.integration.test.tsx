/**
 * @vitest-environment jsdom
 *
 * The reachable-products hook keeps a stable array identity across
 * renders while the answer is unchanged. Consumers put the list in
 * effect dependencies (the "/" landing redirect), so a fresh array on
 * every render re-fires those effects into a render loop.
 *
 * MOVED from `platform/app`. The two mocks that named that application's hooks
 * are the stub host now; what the second scenario asserts is unchanged in
 * substance — a legacy-mode caller must not pay for the product flags — and is
 * asserted where the cost now lives, which is the ask on the host.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { NavigationHostProvider } from "../../model/navigation-host";
import { StubNavigationHost } from "../../testing";
import { useReachableProducts } from "../use-reachable-products";

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
