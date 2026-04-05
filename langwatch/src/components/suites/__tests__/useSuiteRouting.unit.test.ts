/**
 * @vitest-environment jsdom
 *
 * Unit tests for useSuiteRouting hook — path-based routing.
 *
 * Verifies URL-based suite selection via path segments:
 *   /simulations                              → All Runs
 *   /simulations/run-plans/:suiteSlug         → Suite detail
 *   /simulations/:externalSetSlug/:batchId    → External set + highlight
 *
 * Sidebar navigation uses window.history.pushState (not router.push)
 * to avoid full Next.js page transitions.
 *
 * @see specs/suites/simulation-runs-page.feature
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPushState = vi.fn();

const mockRouter = {
  query: { project: "my-project" } as Record<string, string | string[] | undefined>,
  pathname: "/[project]/simulations" as string,
  asPath: "/my-project/simulations" as string,
  push: vi.fn(),
  isReady: true,
};

vi.mock("next/router", () => ({
  useRouter: () => mockRouter,
}));

import { ALL_RUNS_ID, EXTERNAL_SET_PREFIX, useSuiteRouting, deriveFromPath } from "../useSuiteRouting";

describe("useSuiteRouting()", () => {
  beforeEach(() => {
    mockPushState.mockClear();
    mockRouter.query = { project: "my-project" };
    mockRouter.pathname = "/[project]/simulations";
    mockRouter.asPath = "/my-project/simulations";
    mockRouter.isReady = true;

    // Mock window.history.pushState for navigation tests
    vi.spyOn(window.history, "pushState").mockImplementation(mockPushState);
  });

  describe("given /simulations base path (no further segments)", () => {
    it("returns 'all-runs' as selectedSuiteSlug", () => {
      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe(ALL_RUNS_ID);
      expect(result.current.highlightBatchId).toBeNull();
    });
  });

  describe("given /simulations/run-plans/[suiteSlug]", () => {
    it("returns the suite slug", () => {
      mockRouter.pathname = "/[project]/simulations/run-plans/[suiteSlug]";
      mockRouter.query = { project: "my-project", suiteSlug: "critical-path" };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe("critical-path");
      expect(result.current.highlightBatchId).toBeNull();
    });
  });

  describe("given /simulations/run-plans/[suiteSlug]/[batchId]", () => {
    it("returns suite slug and highlight batch id", () => {
      mockRouter.pathname = "/[project]/simulations/run-plans/[suiteSlug]/[batchId]";
      mockRouter.query = {
        project: "my-project",
        suiteSlug: "critical-path",
        batchId: "scenariobatch_abc",
      };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe("critical-path");
      expect(result.current.highlightBatchId).toBe("scenariobatch_abc");
    });
  });

  describe("given /simulations/[scenarioSetId] (external set)", () => {
    it("returns external set selection", () => {
      mockRouter.pathname = "/[project]/simulations/[scenarioSetId]";
      mockRouter.query = { project: "my-project", scenarioSetId: "python-examples" };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe(`${EXTERNAL_SET_PREFIX}python-examples`);
      expect(result.current.highlightBatchId).toBeNull();
    });
  });

  describe("given /simulations/[scenarioSetId]/[batchRunId]", () => {
    it("returns external set with batch highlight", () => {
      mockRouter.pathname = "/[project]/simulations/[scenarioSetId]/[batchRunId]";
      mockRouter.query = {
        project: "my-project",
        scenarioSetId: "python-examples",
        batchRunId: "scenariobatch_xyz",
      };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe(`${EXTERNAL_SET_PREFIX}python-examples`);
      expect(result.current.highlightBatchId).toBe("scenariobatch_xyz");
    });
  });

  describe("when navigateToSuite is called with a suite slug", () => {
    it("uses pushState to update URL without full page transition", () => {
      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite("critical-path");
      });

      expect(mockPushState).toHaveBeenCalledWith(
        null, "", "/my-project/simulations/run-plans/critical-path",
      );
      expect(result.current.selectedSuiteSlug).toBe("critical-path");
    });
  });

  describe("when navigateToSuite is called with 'all-runs'", () => {
    it("uses pushState to navigate to /simulations", () => {
      mockRouter.pathname = "/[project]/simulations/run-plans/[suiteSlug]";
      mockRouter.query = { project: "my-project", suiteSlug: "critical-path" };

      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite(ALL_RUNS_ID);
      });

      expect(mockPushState).toHaveBeenCalledWith(
        null, "", "/my-project/simulations",
      );
      expect(result.current.selectedSuiteSlug).toBe(ALL_RUNS_ID);
    });
  });

  describe("when navigateToSuite is called with an external set", () => {
    it("uses pushState to navigate to /simulations/:setId", () => {
      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite(`${EXTERNAL_SET_PREFIX}python-examples`);
      });

      expect(mockPushState).toHaveBeenCalledWith(
        null, "", "/my-project/simulations/python-examples",
      );
      expect(result.current.selectedSuiteSlug).toBe(`${EXTERNAL_SET_PREFIX}python-examples`);
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

      expect(mockPushState).not.toHaveBeenCalled();
    });
  });
});

describe("deriveFromPath", () => {
  it("handles the base path as All Runs", () => {
    const result = deriveFromPath({
      isReady: true,
      pathname: "/[project]/simulations",
      query: { project: "my-project" },
    });
    expect(result.selectedSuiteSlug).toBe(ALL_RUNS_ID);
    expect(result.highlightBatchId).toBeNull();
  });

  it("handles run-plans path with suite slug", () => {
    const result = deriveFromPath({
      isReady: true,
      pathname: "/[project]/simulations/run-plans/[suiteSlug]",
      query: { project: "my-project", suiteSlug: "my-suite" },
    });
    expect(result.selectedSuiteSlug).toBe("my-suite");
  });

  it("handles external set with batch id via scenarioSetId", () => {
    const result = deriveFromPath({
      isReady: true,
      pathname: "/[project]/simulations/[scenarioSetId]/[batchRunId]",
      query: { project: "my-project", scenarioSetId: "default", batchRunId: "batch_123" },
    });
    expect(result.selectedSuiteSlug).toBe(`${EXTERNAL_SET_PREFIX}default`);
    expect(result.highlightBatchId).toBe("batch_123");
  });
});
