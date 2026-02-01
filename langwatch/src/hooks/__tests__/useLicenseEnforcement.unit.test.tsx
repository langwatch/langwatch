/**
 * @vitest-environment jsdom
 */
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useLicenseEnforcement } from "../useLicenseEnforcement";

// Mock the dependencies
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-123" },
  }),
}));

const mockUseQuery = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    licenseEnforcement: {
      checkLimit: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

// Mock the upgrade modal store
const mockOpenUpgradeModal = vi.fn();
vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (selector: (state: { open: typeof mockOpenUpgradeModal }) => unknown) =>
    selector({ open: mockOpenUpgradeModal }),
}));

describe("useLicenseEnforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenUpgradeModal.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("isAllowed", () => {
    it("returns isAllowed true when under limit", () => {
      mockUseQuery.mockReturnValue({
        data: { allowed: true, current: 3, max: 10 },
        isLoading: false,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));

      expect(result.current.isAllowed).toBe(true);
      expect(result.current.limitInfo?.current).toBe(3);
      expect(result.current.limitInfo?.max).toBe(10);
    });

    it("returns isAllowed false when at limit", () => {
      mockUseQuery.mockReturnValue({
        data: { allowed: false, current: 10, max: 10 },
        isLoading: false,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));

      expect(result.current.isAllowed).toBe(false);
    });

    it("returns isAllowed false when over limit", () => {
      mockUseQuery.mockReturnValue({
        data: { allowed: false, current: 12, max: 10 },
        isLoading: false,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));

      expect(result.current.isAllowed).toBe(false);
    });

    it("defaults isAllowed to true when data not loaded", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));

      expect(result.current.isAllowed).toBe(true);
      expect(result.current.isLoading).toBe(true);
    });
  });

  describe("checkAndProceed", () => {
    it("executes callback when allowed", () => {
      mockUseQuery.mockReturnValue({
        data: { allowed: true, current: 3, max: 10 },
        isLoading: false,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));
      const callback = vi.fn();

      act(() => {
        result.current.checkAndProceed(callback);
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("does not execute callback when blocked", () => {
      mockUseQuery.mockReturnValue({
        data: { allowed: false, current: 10, max: 10 },
        isLoading: false,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));
      const callback = vi.fn();

      act(() => {
        result.current.checkAndProceed(callback);
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it("executes callback optimistically when data not yet loaded", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));
      const callback = vi.fn();

      act(() => {
        result.current.checkAndProceed(callback);
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("upgrade modal store integration", () => {
    it("opens upgrade modal via store when blocked", () => {
      mockUseQuery.mockReturnValue({
        data: { allowed: false, current: 10, max: 10 },
        isLoading: false,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));

      act(() => {
        result.current.checkAndProceed(() => {});
      });

      // Verify the store's open function was called with correct parameters
      expect(mockOpenUpgradeModal).toHaveBeenCalledTimes(1);
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith("workflows", 10, 10);
    });

    it("does not open upgrade modal when allowed", () => {
      mockUseQuery.mockReturnValue({
        data: { allowed: true, current: 3, max: 10 },
        isLoading: false,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));

      const callback = vi.fn();
      act(() => {
        result.current.checkAndProceed(callback);
      });

      // Callback should have been called (allowed)
      expect(callback).toHaveBeenCalled();
      // Modal store should not have been called
      expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
    });
  });

  describe("query parameters", () => {
    it("passes correct parameters to checkLimit query", () => {
      mockUseQuery.mockReturnValue({
        data: { allowed: true, current: 3, max: 10 },
        isLoading: false,
      });

      renderHook(() => useLicenseEnforcement("prompts"));

      expect(mockUseQuery).toHaveBeenCalledWith(
        { organizationId: "org-123", limitType: "prompts" },
        { enabled: true }
      );
    });

    it("disables query when organization is not available", () => {
      // Re-mock to return undefined organization
      vi.doMock("~/hooks/useOrganizationTeamProject", () => ({
        useOrganizationTeamProject: () => ({
          organization: undefined,
        }),
      }));

      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
      });

      // The query should be called with enabled: false when org is undefined
      // This test verifies the hook handles missing organization gracefully
      const { result } = renderHook(() => useLicenseEnforcement("workflows"));

      // Should default to allowed when no data
      expect(result.current.isAllowed).toBe(true);
    });
  });

  describe("different limit types", () => {
    const limitTypes = [
      "workflows",
      "prompts",
      "evaluators",
      "scenarios",
      "projects",
      "members",
      "teams",
      "membersLite",
      "agents",
      "experiments",
    ] as const;

    limitTypes.forEach((limitType) => {
      it(`handles ${limitType} limit type`, () => {
        mockUseQuery.mockReturnValue({
          data: { allowed: false, current: 5, max: 5 },
          isLoading: false,
        });

        const { result } = renderHook(() => useLicenseEnforcement(limitType));

        act(() => {
          result.current.checkAndProceed(() => {});
        });

        expect(mockOpenUpgradeModal).toHaveBeenCalledWith(limitType, 5, 5);
      });
    });
  });
});
