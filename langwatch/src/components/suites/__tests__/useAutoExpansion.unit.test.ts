/**
 * @vitest-environment jsdom
 *
 * @see specs/suites/simulations-performance.feature — "Only the most recent
 * execution starts expanded" / "Manually collapsed executions stay collapsed"
 * / "Newly arriving executions expand automatically"
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAutoExpansion } from "../useAutoExpansion";

// The hook keeps a module-level cache keyed by panelKey::groupBy, so every
// test uses a unique panel key to stay isolated.
let keyCounter = 0;
const freshPanelKey = () => `panel-${++keyCounter}`;

const batches = (...ids: string[]) => ids.map((id) => ({ batchRunId: id }));

describe("useAutoExpansion()", () => {
  describe("given a panel opened for the first time", () => {
    it("expands only the most recent batch", () => {
      const panelKey = freshPanelKey();
      const { result } = renderHook(() =>
        useAutoExpansion({
          panelKey,
          groupBy: "none",
          batchRuns: batches("newest", "older", "oldest"),
          groups: [],
        }),
      );

      expect([...result.current.expandedIds]).toEqual(["newest"]);
    });

    it("keeps older batches expandable manually", () => {
      const panelKey = freshPanelKey();
      const { result } = renderHook(() =>
        useAutoExpansion({
          panelKey,
          groupBy: "none",
          batchRuns: batches("newest", "older"),
          groups: [],
        }),
      );

      act(() => result.current.toggleExpanded("older"));

      expect(result.current.expandedIds.has("older")).toBe(true);
      expect(result.current.expandedIds.has("newest")).toBe(true);
    });
  });

  describe("given a refresh with no new batches", () => {
    it("does not expand batches that were present but collapsed", () => {
      const panelKey = freshPanelKey();
      const { result, rerender } = renderHook(
        ({ batchRuns }) =>
          useAutoExpansion({ panelKey, groupBy: "none", batchRuns, groups: [] }),
        { initialProps: { batchRuns: batches("newest", "older") } },
      );

      // A refresh delivers the same batches as new array identities
      rerender({ batchRuns: batches("newest", "older") });

      expect(result.current.expandedIds.has("older")).toBe(false);
      expect(result.current.expandedIds.has("newest")).toBe(true);
    });

    it("keeps a manually collapsed batch collapsed", () => {
      const panelKey = freshPanelKey();
      const { result, rerender } = renderHook(
        ({ batchRuns }) =>
          useAutoExpansion({ panelKey, groupBy: "none", batchRuns, groups: [] }),
        { initialProps: { batchRuns: batches("newest", "older") } },
      );

      act(() => result.current.toggleExpanded("newest"));
      rerender({ batchRuns: batches("newest", "older") });

      expect(result.current.expandedIds.has("newest")).toBe(false);
    });
  });

  describe("given a new batch arrives after first load", () => {
    it("auto-expands only the new arrival", () => {
      const panelKey = freshPanelKey();
      const { result, rerender } = renderHook(
        ({ batchRuns }) =>
          useAutoExpansion({ panelKey, groupBy: "none", batchRuns, groups: [] }),
        { initialProps: { batchRuns: batches("newest", "older") } },
      );

      rerender({ batchRuns: batches("brand-new", "newest", "older") });

      expect(result.current.expandedIds.has("brand-new")).toBe(true);
      expect(result.current.expandedIds.has("newest")).toBe(true);
      expect(result.current.expandedIds.has("older")).toBe(false);
    });
  });

  describe("given older batches are paginated in via Load More", () => {
    it("marks them seen without auto-expanding them", () => {
      const panelKey = freshPanelKey();
      const { result, rerender } = renderHook(
        ({ batchRuns }) =>
          useAutoExpansion({ panelKey, groupBy: "none", batchRuns, groups: [] }),
        { initialProps: { batchRuns: batches("newest", "older") } },
      );

      // Load More appends older pages behind the already-seen rows
      rerender({
        batchRuns: batches("newest", "older", "paged-1", "paged-2"),
      });

      expect(result.current.expandedIds.has("paged-1")).toBe(false);
      expect(result.current.expandedIds.has("paged-2")).toBe(false);
      expect(result.current.expandedIds.has("newest")).toBe(true);
    });

    it("still auto-expands a new arrival delivered alongside a paged-in tail", () => {
      const panelKey = freshPanelKey();
      const { result, rerender } = renderHook(
        ({ batchRuns }) =>
          useAutoExpansion({ panelKey, groupBy: "none", batchRuns, groups: [] }),
        { initialProps: { batchRuns: batches("newest", "older") } },
      );

      rerender({
        batchRuns: batches("brand-new", "newest", "older", "paged-1"),
      });

      expect(result.current.expandedIds.has("brand-new")).toBe(true);
      expect(result.current.expandedIds.has("paged-1")).toBe(false);
    });
  });

  describe("given grouped mode", () => {
    it("expands only the most recent group on first load", () => {
      const panelKey = freshPanelKey();
      const { result } = renderHook(() =>
        useAutoExpansion({
          panelKey,
          groupBy: "scenario",
          batchRuns: [],
          groups: [{ groupKey: "g-newest" }, { groupKey: "g-older" }],
        }),
      );

      expect([...result.current.expandedIds]).toEqual(["g-newest"]);
    });
  });
});
