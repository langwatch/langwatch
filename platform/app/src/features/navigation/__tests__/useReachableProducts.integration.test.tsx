/**
 * @vitest-environment jsdom
 *
 * The reachable-products hook keeps a stable array identity across
 * renders while the answer is unchanged. Consumers put the list in
 * effect dependencies (the "/" landing redirect), so a fresh array on
 * every render re-fires those effects into a render loop.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_1" },
    isLoading: false,
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

import { useReachableProducts } from "../useReachableProducts";

describe("useReachableProducts", () => {
  describe("when nothing changes between renders", () => {
    it("returns the same array identity", () => {
      const { result, rerender } = renderHook(() => useReachableProducts());
      const first = result.current.reachableProducts;

      rerender();

      expect(result.current.reachableProducts).toBe(first);
      expect(first).toEqual(["me", "llm-ops", "gateway", "governance"]);
    });
  });
});
