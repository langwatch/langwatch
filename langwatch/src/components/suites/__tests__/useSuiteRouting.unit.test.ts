/**
 * @vitest-environment jsdom
 *
 * Unit tests for useSuiteRouting hook.
 *
 * Verifies URL-based suite selection: reading suite slug from query param,
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

  describe("when no suite param is in the URL", () => {
    it("returns 'all-runs' as selectedSuiteSlug", () => {
      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe(ALL_RUNS_ID);
    });
  });

  describe("when suite param is in the URL", () => {
    it("returns the slug as selectedSuiteSlug", () => {
      mockRouter.query = { project: "my-project", suite: "my-regression-suite" };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe("my-regression-suite");
    });
  });

  describe("when navigateToSuite is called with a slug", () => {
    it("pushes with href object and as URL using shallow routing", () => {
      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite("my-regression-suite");
      });

      expect(mockPush).toHaveBeenCalledWith(
        {
          pathname: "/[project]/simulations/suites",
          query: { project: "my-project", suite: "my-regression-suite" },
        },
        "/my-project/simulations/suites?suite=my-regression-suite",
        { shallow: true },
      );
    });
  });

  describe("when navigateToSuite is called with 'all-runs'", () => {
    it("pushes to base path without suite param", () => {
      mockRouter.query = { project: "my-project", suite: "my-regression-suite" };

      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite(ALL_RUNS_ID);
      });

      expect(mockPush).toHaveBeenCalledWith(
        {
          pathname: "/[project]/simulations/suites",
          query: { project: "my-project" },
        },
        "/my-project/simulations/suites",
        { shallow: true },
      );
    });
  });

  describe("when router is not ready", () => {
    it("returns null as selectedSuiteSlug", () => {
      mockRouter.isReady = false;
      mockRouter.query = {};

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBeNull();
    });
  });

  describe("when projectSlug is undefined", () => {
    it("does not navigate", () => {
      mockRouter.query = {};

      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite("some-suite");
      });

      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
