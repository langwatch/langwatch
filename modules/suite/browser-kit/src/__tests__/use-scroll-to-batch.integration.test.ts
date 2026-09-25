// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollToBatch } from "../behavior/use-scroll-to-batch.ts";

function addRow(batchId: string): { scrollIntoView: ReturnType<typeof vi.fn> } {
  const row = document.createElement("div");
  row.dataset.batchId = batchId;
  const scrollIntoView = vi.fn();
  row.scrollIntoView = scrollIntoView;
  document.body.appendChild(row);
  return { scrollIntoView };
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useScrollToBatch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  describe("given no batch to highlight", () => {
    it("highlights nothing", () => {
      const { result } = renderHook(() => useScrollToBatch({ highlightBatchId: null }));
      expect(result.current.highlightedBatchId).toBeNull();
    });
  });

  describe("given the batch row is not the first row", () => {
    it("scrolls it into view, highlights it, then clears the highlight", () => {
      addRow("first");
      const row = addRow("batch-2");
      const { result } = renderHook(() => useScrollToBatch({ highlightBatchId: "batch-2" }));

      advance(100);
      expect(row.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
      expect(result.current.highlightedBatchId).toBe("batch-2");

      advance(2000);
      expect(result.current.highlightedBatchId).toBeNull();
    });
  });

  describe("given the batch row is the first row", () => {
    it("highlights it without scrolling", () => {
      const row = addRow("batch-1");
      const { result } = renderHook(() => useScrollToBatch({ highlightBatchId: "batch-1" }));

      advance(100);
      expect(row.scrollIntoView).not.toHaveBeenCalled();
      expect(result.current.highlightedBatchId).toBe("batch-1");
    });
  });

  describe("given the row appears only after a few frames", () => {
    it("keeps polling until it is there", () => {
      const { result } = renderHook(() => useScrollToBatch({ highlightBatchId: "late" }));
      advance(100);
      expect(result.current.highlightedBatchId).toBeNull();

      addRow("late");
      advance(100);
      expect(result.current.highlightedBatchId).toBe("late");
    });
  });

  describe("given the row never appears", () => {
    it("stops polling after its attempts run out", () => {
      const { result } = renderHook(() => useScrollToBatch({ highlightBatchId: "missing" }));
      advance(100 + 60 * 20);
      addRow("missing");
      advance(1000);
      expect(result.current.highlightedBatchId).toBeNull();
    });
  });

  describe("when the hook unmounts mid-highlight", () => {
    it("clears its timers", () => {
      addRow("batch-3");
      const { unmount } = renderHook(() => useScrollToBatch({ highlightBatchId: "batch-3" }));
      advance(100);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
