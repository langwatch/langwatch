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
