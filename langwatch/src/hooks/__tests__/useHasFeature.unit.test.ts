/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHasFeature } from "../useHasFeature";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}));

import { useSession } from "next-auth/react";

const mockUseSession = vi.mocked(useSession);

describe("useHasFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("user-level flags", () => {
    it("returns false when no session", () => {
      mockUseSession.mockReturnValue({
        data: null,
        status: "unauthenticated",
        update: vi.fn(),
      });

      const { result } = renderHook(() => useHasFeature());

      expect(result.current("release_ui_simulations_menu_enabled")).toBe(false);
    });

    it("returns false when flag not in enabledFeatures", () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { id: "1", enabledFeatures: [] },
          expires: "2025-01-01",
        },
        status: "authenticated",
        update: vi.fn(),
      });

      const { result } = renderHook(() => useHasFeature());

      expect(result.current("release_ui_simulations_menu_enabled")).toBe(false);
    });

    it("returns true when flag in enabledFeatures", () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { id: "1", enabledFeatures: ["release_ui_simulations_menu_enabled"] },
          expires: "2025-01-01",
        },
        status: "authenticated",
        update: vi.fn(),
      });

      const { result } = renderHook(() => useHasFeature());

      expect(result.current("release_ui_simulations_menu_enabled")).toBe(true);
    });
  });

});
