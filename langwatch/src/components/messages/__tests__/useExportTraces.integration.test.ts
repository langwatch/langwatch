/**
 * @vitest-environment jsdom
 *
 * Integration tests for the useExportTraces hook.
 *
 * Tests dialog state management and export trigger behavior.
 * Network calls (fetch) are mocked at external boundaries.
 * tRPC subscription for progress is mocked via the api module.
 *
 * @see specs/traces/trace-export.feature
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExportTraces } from "../useExportTraces";

const { mockToasterCreate } = vi.hoisted(() => ({
  mockToasterCreate: vi.fn(),
}));

// Mock toaster
vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mockToasterCreate },
}));

// Mock tRPC api — the subscription is a no-op in tests
vi.mock("~/utils/api", () => ({
  api: {
    export: {
      onExportProgress: {
        useSubscription: vi.fn(),
      },
    },
  },
}));

describe("useExportTraces()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when initialized", () => {
    it("starts with dialog closed", () => {
      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      expect(result.current.isDialogOpen).toBe(false);
    });

    it("starts with isExporting false", () => {
      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      expect(result.current.isExporting).toBe(false);
    });

    it("starts with zero progress", () => {
      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      expect(result.current.progress).toEqual({ exported: 0, total: 0 });
    });
  });

  describe("when openExportDialog is called", () => {
    it("opens the dialog", () => {
      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      act(() => {
        result.current.openExportDialog();
      });

      expect(result.current.isDialogOpen).toBe(true);
    });
  });

  describe("when closeExportDialog is called", () => {
    it("closes the dialog", () => {
      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      act(() => {
        result.current.openExportDialog();
      });
      expect(result.current.isDialogOpen).toBe(true);

      act(() => {
        result.current.closeExportDialog();
      });
      expect(result.current.isDialogOpen).toBe(false);
    });
  });

  describe("when startExport is called", () => {
    it("closes the dialog", () => {
      // Mock fetch to return a resolved promise
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers(),
          blob: vi.fn().mockResolvedValue(new Blob()),
        })
      );

      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      act(() => {
        result.current.openExportDialog();
      });
      expect(result.current.isDialogOpen).toBe(true);

      act(() => {
        result.current.startExport({ mode: "summary", format: "csv" });
      });

      expect(result.current.isDialogOpen).toBe(false);
    });

    it("sets isExporting to true", () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers(),
          blob: vi.fn().mockResolvedValue(new Blob()),
        })
      );

      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      act(() => {
        result.current.startExport({ mode: "summary", format: "csv" });
      });

      expect(result.current.isExporting).toBe(true);
    });
  });

  describe("when cancelExport is called", () => {
    it("sets isExporting to false", () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers(),
          blob: vi.fn().mockResolvedValue(new Blob()),
        })
      );

      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      act(() => {
        result.current.startExport({ mode: "full", format: "json" });
      });
      expect(result.current.isExporting).toBe(true);

      act(() => {
        result.current.cancelExport();
      });

      expect(result.current.isExporting).toBe(false);
    });

    it("resets progress to zero", () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers(),
          blob: vi.fn().mockResolvedValue(new Blob()),
        })
      );

      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      act(() => {
        result.current.startExport({ mode: "summary", format: "csv" });
      });

      act(() => {
        result.current.cancelExport();
      });

      expect(result.current.progress).toEqual({ exported: 0, total: 0 });
    });
  });

  describe("when a second export starts while the first is in-flight", () => {
    it("aborts the first export's fetch request", () => {
      const abortSpy = vi.fn();
      let callCount = 0;

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          callCount++;
          if (callCount === 1) {
            // First export: spy on its signal
            init.signal?.addEventListener("abort", abortSpy);
          }
          // Return a promise that never resolves so the export stays in-flight
          return new Promise(() => {});
        })
      );

      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      act(() => {
        result.current.startExport({ mode: "summary", format: "csv" });
      });

      expect(result.current.isExporting).toBe(true);
      expect(abortSpy).not.toHaveBeenCalled();

      // Start a second export
      act(() => {
        result.current.startExport({ mode: "full", format: "json" });
      });

      expect(abortSpy).toHaveBeenCalledTimes(1);
      // Still exporting (now export B is active)
      expect(result.current.isExporting).toBe(true);
    });

    it("prevents the first export's completion handler from mutating state", async () => {
      let firstFetchResolve: ((value: Response) => void) | null = null;
      let callCount = 0;

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // First export: return a controllable promise
            return new Promise<Response>((resolve) => {
              firstFetchResolve = resolve;
            });
          }
          // Second export: never resolves
          return new Promise(() => {});
        })
      );

      const { result } = renderHook(() =>
        useExportTraces({ projectId: "proj-1" })
      );

      // Start first export
      act(() => {
        result.current.startExport({ mode: "summary", format: "csv" });
      });

      // Start second export (replaces the active controller)
      act(() => {
        result.current.startExport({ mode: "full", format: "json" });
      });

      expect(result.current.isExporting).toBe(true);

      // Now resolve first export (it was aborted, but let's simulate the .catch path)
      // The abort would cause an AbortError, returning false from catch.
      // Resolve with an error response to trigger the catch path with a non-abort error.
      await act(async () => {
        firstFetchResolve!({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          headers: new Headers(),
        } as unknown as Response);
        // Allow microtasks to flush
        await new Promise((r) => setTimeout(r, 0));
      });

      // isExporting should still be true because the stale guard prevents
      // the first export's handler from resetting state
      expect(result.current.isExporting).toBe(true);
    });
  });

  describe("when projectId is undefined", () => {
    it("does not start export and shows error toast", () => {
      const { result } = renderHook(() =>
        useExportTraces({ projectId: undefined })
      );

      act(() => {
        result.current.startExport({ mode: "summary", format: "csv" });
      });

      expect(result.current.isExporting).toBe(false);
      expect(mockToasterCreate).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" })
      );
    });
  });
});
