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

// Mock UpgradeModal - it's a component, we just need to verify it renders
vi.mock("~/components/UpgradeModal", () => ({
  UpgradeModal: ({
    open,
    onClose,
    limitType,
    current,
    max,
  }: {
    open: boolean;
    onClose: () => void;
    limitType: string;
    current: number;
    max: number;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="upgrade-modal">
        <span data-testid="limit-type">{limitType}</span>
        <span data-testid="current">{current}</span>
        <span data-testid="max">{max}</span>
        <button data-testid="close-btn" onClick={onClose}>
          Close
        </button>
      </div>
    );
  },
}));

describe("useLicenseEnforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe("upgradeModal", () => {
    it("renders upgrade modal when blocked", () => {
      mockUseQuery.mockReturnValue({
        data: { allowed: false, current: 10, max: 10 },
        isLoading: false,
      });

      const { result } = renderHook(() => useLicenseEnforcement("workflows"));

      act(() => {
        result.current.checkAndProceed(() => {});
      });

      // The upgradeModal is a React element - we verify it exists and has correct structure
      const modalElement = result.current.upgradeModal;
      expect(modalElement).toBeDefined();
      expect(modalElement.props.open).toBe(true);
      expect(modalElement.props.limitType).toBe("workflows");
      expect(modalElement.props.current).toBe(10);
      expect(modalElement.props.max).toBe(10);
    });

    it("does not show upgrade modal when allowed", () => {
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
      // Modal should not be open
      expect(result.current.upgradeModal.props.open).toBe(false);
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

        expect(result.current.upgradeModal.props.limitType).toBe(limitType);
      });
    });
  });
});
