/** @vitest-environment jsdom */
/** Spec: specs/traces-v2/trace-table.feature */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEffectiveLens, useViewStore } from "../view.store";

describe("useEffectiveLens", () => {
  describe("when the view store has not changed between renders", () => {
    /** @scenario "The trace table's lens subscription settles" */
    it("returns the same lens object, so the snapshot is cached", () => {
      const { result, rerender } = renderHook(() => useEffectiveLens());
      const first = result.current;
      rerender();
      expect(result.current).toBe(first);
      expect(first).not.toBeNull();
    });
  });

  describe("when the grouping changes", () => {
    it("derives a lens carrying the new grouping", () => {
      const { result } = renderHook(() => useEffectiveLens());
      const before = result.current?.grouping;
      act(() => {
        useViewStore.getState().setGrouping(before === "flat" ? "by-service" : "flat");
      });
      expect(result.current?.grouping).not.toBe(before);
    });
  });
});
