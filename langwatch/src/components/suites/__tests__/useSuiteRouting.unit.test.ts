/**
 * @vitest-environment jsdom
 *
 * Unit tests for useSuiteRouting hook.
 *
 * Verifies URL-based suite selection: reading suiteId from router query,
 * navigating to suites, and navigating to all-runs.
 *
 * @see specs/features/suites/suite-url-routing.feature
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPush = vi.fn();
const mockRouter = {
  query: { project: "my-project" } as Record<string, string | string[] | undefined>,
  push: mockPush,
  isReady: true,
};

vi.mock("next/router", () => ({
  useRouter: () => mockRouter,
}));

import { ALL_RUNS_ID, useSuiteRouting } from "../useSuiteRouting";

describe("useSuiteRouting()", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRouter.query = { project: "my-project" };
    mockRouter.isReady = true;
  });

  describe("when no suiteId is in the URL", () => {
    it("returns 'all-runs' as selectedSuiteId", () => {
      mockRouter.query = { project: "my-project" };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteId).toBe(ALL_RUNS_ID);
    });
  });

  describe("when suiteId is in the URL", () => {
    it("returns the suiteId as selectedSuiteId", () => {
      mockRouter.query = { project: "my-project", suiteId: ["suite_123"] };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteId).toBe("suite_123");
    });
  });

  describe("when suiteId is an empty array", () => {
    it("returns 'all-runs' as selectedSuiteId", () => {
      mockRouter.query = { project: "my-project", suiteId: [] };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteId).toBe(ALL_RUNS_ID);
    });
  });

  describe("when navigateToSuite is called with a suite ID", () => {
    it("pushes to the suite URL with shallow routing", () => {
      mockRouter.query = { project: "my-project" };

      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite("suite_456");
      });

      expect(mockPush).toHaveBeenCalledWith(
        "/my-project/simulations/suites/suite_456",
        undefined,
        { shallow: true },
      );
    });
  });

  describe("when navigateToSuite is called with 'all-runs'", () => {
    it("pushes to the base suites URL with shallow routing", () => {
      mockRouter.query = { project: "my-project", suiteId: ["suite_123"] };

      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite(ALL_RUNS_ID);
      });

      expect(mockPush).toHaveBeenCalledWith(
        "/my-project/simulations/suites",
        undefined,
        { shallow: true },
      );
    });
  });

  describe("when router is not ready", () => {
    it("returns null as selectedSuiteId", () => {
      mockRouter.isReady = false;
      mockRouter.query = {};

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteId).toBeNull();
    });
  });
});
