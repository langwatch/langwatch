/**
 * @vitest-environment jsdom
 *
 * Unit tests for useSuiteRouting hook — catch-all path routing.
 *
 * All simulation sub-paths are handled by [[...path]].tsx, so
 * sidebar navigation uses shallow routing within the same page.
 *
 * @see specs/suites/simulation-runs-page.feature
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPush = vi.fn();

const mockRouter = {
  query: { project: "my-project" } as Record<string, string | string[] | undefined>,
  pathname: "/[project]/simulations/[[...path]]" as string,
  asPath: "/my-project/simulations" as string,
  push: mockPush,
  isReady: true,
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => mockRouter,
}));

import { ALL_RUNS_ID, EXTERNAL_SET_PREFIX, useSuiteRouting, deriveFromPath } from "../useSuiteRouting";

describe("useSuiteRouting()", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRouter.query = { project: "my-project" };
    mockRouter.isReady = true;
  });

  describe("given /simulations (no path segments)", () => {
    it("returns all-runs", () => {
      mockRouter.query = { project: "my-project" };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe(ALL_RUNS_ID);
      expect(result.current.highlightBatchId).toBeNull();
    });
  });

  describe("given /simulations/run-plans/slug", () => {
    it("returns the suite slug", () => {
      mockRouter.query = { project: "my-project", path: ["run-plans", "critical-path"] };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe("critical-path");
      expect(result.current.highlightBatchId).toBeNull();
    });
  });

  describe("given /simulations/run-plans/slug/batchId", () => {
    it("returns suite slug with batch highlight", () => {
      mockRouter.query = { project: "my-project", path: ["run-plans", "critical-path", "batch_abc"] };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe("critical-path");
      expect(result.current.highlightBatchId).toBe("batch_abc");
    });
  });

  describe("given /simulations/setId (external set)", () => {
    it("returns external set selection", () => {
      mockRouter.query = { project: "my-project", path: ["python-examples"] };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe(`${EXTERNAL_SET_PREFIX}python-examples`);
      expect(result.current.highlightBatchId).toBeNull();
    });
  });

  describe("given /simulations/setId/batchId (external set + batch)", () => {
    it("returns external set with batch highlight", () => {
      mockRouter.query = { project: "my-project", path: ["python-examples", "batch_xyz"] };

      const { result } = renderHook(() => useSuiteRouting());

      expect(result.current.selectedSuiteSlug).toBe(`${EXTERNAL_SET_PREFIX}python-examples`);
      expect(result.current.highlightBatchId).toBe("batch_xyz");
    });
  });

  describe("when navigateToSuite is called with a suite slug", () => {
    it("uses shallow router.push to same page", () => {
      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite("critical-path");
      });

      expect(mockPush).toHaveBeenCalledWith(
        {
          pathname: "/[project]/simulations/[[...path]]",
          query: { project: "my-project", path: ["run-plans", "critical-path"] },
        },
        "/my-project/simulations/run-plans/critical-path",
        { shallow: true },
      );
    });
  });

  describe("when navigateToSuite is called with all-runs", () => {
    it("uses shallow router.push with no path", () => {
      mockRouter.query = { project: "my-project", path: ["run-plans", "critical-path"] };

      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite(ALL_RUNS_ID);
      });

      expect(mockPush).toHaveBeenCalledWith(
        {
          pathname: "/[project]/simulations/[[...path]]",
          query: { project: "my-project" },
        },
        "/my-project/simulations",
        { shallow: true },
      );
    });
  });

  describe("when navigateToSuite is called with an external set", () => {
    it("uses shallow router.push with setId path", () => {
      const { result } = renderHook(() => useSuiteRouting());

      act(() => {
        result.current.navigateToSuite(`${EXTERNAL_SET_PREFIX}python-examples`);
      });

      expect(mockPush).toHaveBeenCalledWith(
        {
          pathname: "/[project]/simulations/[[...path]]",
          query: { project: "my-project", path: ["python-examples"] },
        },
        "/my-project/simulations/python-examples",
        { shallow: true },
      );
    });
  });

  describe("when router is not ready", () => {
    it("returns null", () => {
      mockRouter.isReady = false;
      const { result } = renderHook(() => useSuiteRouting());
      expect(result.current.selectedSuiteSlug).toBeNull();
    });
  });

  describe("when projectSlug is undefined", () => {
    it("does not navigate", () => {
      mockRouter.query = {};
      const { result } = renderHook(() => useSuiteRouting());
      act(() => { result.current.navigateToSuite("some-suite"); });
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});

describe("deriveFromPath", () => {
  it("returns all-runs for empty path", () => {
    expect(deriveFromPath({ isReady: true, path: undefined })).toEqual({
      selectedSuiteSlug: ALL_RUNS_ID, highlightBatchId: null,
    });
  });

  it("returns suite slug from run-plans path", () => {
    expect(deriveFromPath({ isReady: true, path: ["run-plans", "my-suite"] })).toEqual({
      selectedSuiteSlug: "my-suite", highlightBatchId: null,
    });
  });

  it("returns external set with batch from path segments", () => {
    expect(deriveFromPath({ isReady: true, path: ["default", "batch_123"] })).toEqual({
      selectedSuiteSlug: `${EXTERNAL_SET_PREFIX}default`, highlightBatchId: "batch_123",
    });
  });

  it("returns null when not ready", () => {
    expect(deriveFromPath({ isReady: false, path: undefined })).toEqual({
      selectedSuiteSlug: null, highlightBatchId: null,
    });
  });
});
