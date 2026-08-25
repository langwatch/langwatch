/**
 * @vitest-environment jsdom
 *
 * The reachable-products hook keeps a stable array identity across
 * renders while the answer is unchanged. Consumers put the list in
 * effect dependencies (the "/" landing redirect), so a fresh array on
 * every render re-fires those effects into a render loop.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_1" },
    isLoading: false,
    hasPermission: () => true,
  }),
}));

const useFeatureFlagMock = vi.fn(() => ({ enabled: true, isLoading: false }));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (...args: unknown[]) =>
    (useFeatureFlagMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

import { useReachableProducts } from "../useReachableProducts";

describe("useReachableProducts", () => {
  beforeEach(() => {
    useFeatureFlagMock.mockClear();
  });

  describe("when nothing changes between renders", () => {
    it("returns the same array identity", () => {
      const { result, rerender } = renderHook(() => useReachableProducts());
      const first = result.current.reachableProducts;

      rerender();

      expect(result.current.reachableProducts).toBe(first);
      expect(first).toEqual(["me", "llm-ops", "gateway", "governance"]);
    });
  });

  describe("when the caller is in legacy mode", () => {
    /** @scenario "Legacy mode runs no navigation-v2 queries" */
    it("keeps the product flag queries disabled", () => {
      const { result } = renderHook(() => useReachableProducts({ enabled: false }));

      expect(result.current.reachableProducts).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      for (const call of useFeatureFlagMock.mock.calls) {
        expect((call as unknown as [string, { enabled: boolean }])[1].enabled).toBe(
          false,
        );
      }
    });
  });
});
