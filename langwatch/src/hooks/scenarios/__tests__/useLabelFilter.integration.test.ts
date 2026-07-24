/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLabelFilter } from "../useLabelFilter";

describe("useLabelFilter()", () => {
  describe("allLabels extraction", () => {
    it("returns empty array when scenarios is undefined", () => {
      const { result } = renderHook(() => useLabelFilter(undefined));

      expect(result.current.allLabels).toEqual([]);
    });

    it("returns empty array when scenarios have no labels", () => {
      const scenarios = [{ labels: [] }, { labels: [] }];
      const { result } = renderHook(() => useLabelFilter(scenarios));

      expect(result.current.allLabels).toEqual([]);
    });

    it("extracts unique labels from all scenarios", () => {
      const scenarios = [
        { labels: ["billing", "urgent"] },
        { labels: ["billing", "support"] },
        { labels: ["edge-case"] },
      ];
      const { result } = renderHook(() => useLabelFilter(scenarios));

      expect(result.current.allLabels).toEqual([
        "billing",
        "edge-case",
        "support",
        "urgent",
      ]);
    });

    it("returns labels sorted alphabetically", () => {
      const scenarios = [{ labels: ["zebra", "alpha", "middle"] }];
      const { result } = renderHook(() => useLabelFilter(scenarios));

      expect(result.current.allLabels).toEqual(["alpha", "middle", "zebra"]);
    });
  });

  describe("activeLabels", () => {
    it("returns empty array initially", () => {
      const { result } = renderHook(() => useLabelFilter([]));

      expect(result.current.activeLabels).toEqual([]);
    });

    it("returns active labels after toggle", () => {
      const { result } = renderHook(() => useLabelFilter([]));

      act(() => {
        result.current.handleLabelToggle("billing");
      });

      expect(result.current.activeLabels).toEqual(["billing"]);
    });
  });

  describe("handleLabelToggle", () => {
    it("adds label when not active", () => {
      const { result } = renderHook(() => useLabelFilter([]));

      act(() => {
        result.current.handleLabelToggle("billing");
      });

      expect(result.current.activeLabels).toContain("billing");
    });

    it("removes label when already active", () => {
      const { result } = renderHook(() => useLabelFilter([]));

      act(() => {
        result.current.handleLabelToggle("billing");
      });
      act(() => {
        result.current.handleLabelToggle("billing");
      });

      expect(result.current.activeLabels).not.toContain("billing");
    });

    it("handles multiple labels", () => {
      const { result } = renderHook(() => useLabelFilter([]));

      act(() => {
        result.current.handleLabelToggle("billing");
      });
      act(() => {
        result.current.handleLabelToggle("support");
      });

      expect(result.current.activeLabels).toEqual(["billing", "support"]);
    });

    it("removes only toggled label", () => {
      const { result } = renderHook(() => useLabelFilter([]));

      act(() => {
        result.current.handleLabelToggle("billing");
      });
      act(() => {
        result.current.handleLabelToggle("support");
      });
      act(() => {
        result.current.handleLabelToggle("billing");
      });

      expect(result.current.activeLabels).toEqual(["support"]);
    });

    it("clears filter when last label removed", () => {
      const { result } = renderHook(() => useLabelFilter([]));

      act(() => {
        result.current.handleLabelToggle("billing");
      });
      act(() => {
        result.current.handleLabelToggle("billing");
      });

      expect(result.current.columnFilters).toEqual([]);
    });
  });

  describe("columnFilters", () => {
    it("preserves other filters when toggling labels", () => {
      const { result } = renderHook(() => useLabelFilter([]));

      // Add a non-label filter
      act(() => {
        result.current.setColumnFilters([{ id: "name", value: "test" }]);
      });

      // Toggle a label
      act(() => {
        result.current.handleLabelToggle("billing");
      });

      expect(result.current.columnFilters).toContainEqual({
        id: "name",
        value: "test",
      });
      expect(result.current.columnFilters).toContainEqual({
        id: "labels",
        value: ["billing"],
      });
    });
  });
});
