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
 * @see specs/suites/simulation-runs-page.feature
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPush = vi.fn();
const mockRouter = {
  query: { project: "my-project" } as Record<string, string | string[] | undefined>,
  pathname: "/[project]/simulations" as string,
  push: mockPush,
  isReady: true,
};

vi.mock("next/router", () => ({
  useRouter: () => mockRouter,
}));

import { ALL_RUNS_ID, EXTERNAL_SET_PREFIX, useSuiteRouting, deriveFromPath } from "../useSuiteRouting";

describe("useSuiteRouting()", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRouter.query = { project: "my-project" };
    mockRouter.pathname = "/[project]/simulations";
    mockRouter.isReady = true;
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
    it("pushes to /simulations/run-plans/:slug", () => {
      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite("critical-path");
      });

      expect(mockPush).toHaveBeenCalledWith(
        "/my-project/simulations/run-plans/critical-path",
      );
    });
  });

  describe("when navigateToSuite is called with 'all-runs'", () => {
    it("pushes to /simulations base path", () => {
      mockRouter.pathname = "/[project]/simulations/run-plans/[suiteSlug]";
      mockRouter.query = { project: "my-project", suiteSlug: "critical-path" };

      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite(ALL_RUNS_ID);
      });

      expect(mockPush).toHaveBeenCalledWith(
        "/my-project/simulations",
      );
    });
  });

  describe("when navigateToSuite is called with an external set", () => {
    it("pushes to /simulations/:setId", () => {
      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite(`${EXTERNAL_SET_PREFIX}python-examples`);
      });

      expect(mockPush).toHaveBeenCalledWith(
        "/my-project/simulations/python-examples",
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
