/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecentItems } from "../useRecentItems";

describe("useRecentItems", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initializes with empty recent items", () => {
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recentItems).toHaveLength(0);
    expect(result.current.hasRecentItems).toBe(false);
  });

  it("adds an item to recent history", () => {
    const { result } = renderHook(() => useRecentItems());

    act(() => {
      result.current.addRecentItem({
        id: "test-1",
        type: "page",
        label: "Test Page",
        path: "/test",
        iconName: "home",
      });
    });

    expect(result.current.recentItems).toHaveLength(1);
    expect(result.current.recentItems[0]?.id).toBe("test-1");
    expect(result.current.hasRecentItems).toBe(true);
  });

  it("updates item when adding duplicate (keeps only one)", () => {
    const { result } = renderHook(() => useRecentItems());

    act(() => {
      result.current.addRecentItem({
        id: "test-1",
        type: "page",
        label: "Test Page",
        path: "/test",
        iconName: "home",
      });
    });

    expect(result.current.recentItems).toHaveLength(1);

    act(() => {
      result.current.addRecentItem({
        id: "test-1",
        type: "page",
        label: "Test Page Updated",
        path: "/test-updated",
        iconName: "home",
      });
    });

    // Should still have only one item (duplicate was replaced)
    expect(result.current.recentItems).toHaveLength(1);
    // The item should have the updated path
    expect(result.current.recentItems[0]?.path).toBe("/test-updated");
  });

  it("clears all recent items", () => {
    const { result } = renderHook(() => useRecentItems());

    act(() => {
      result.current.addRecentItem({
        id: "test-1",
        type: "page",
        label: "Test Page",
        path: "/test",
        iconName: "home",
      });
    });

    expect(result.current.recentItems).toHaveLength(1);

    act(() => {
      result.current.clearRecentItems();
    });

    expect(result.current.recentItems).toHaveLength(0);
    expect(result.current.hasRecentItems).toBe(false);
  });

  it("groups items by time period", () => {
    const { result } = renderHook(() => useRecentItems());
    const now = Date.now();

    act(() => {
      // Add item accessed "today"
      result.current.addRecentItem({
        id: "today-item",
        type: "page",
        label: "Today",
        path: "/today",
        iconName: "home",
      });
    });

    expect(result.current.groupedItems.today).toHaveLength(1);
    expect(result.current.groupedItems.yesterday).toHaveLength(0);
    expect(result.current.groupedItems.pastWeek).toHaveLength(0);
    expect(result.current.groupedItems.past30Days).toHaveLength(0);
  });

  it("maintains most recent items first", () => {
    const { result } = renderHook(() => useRecentItems());

    act(() => {
      result.current.addRecentItem({
        id: "first",
        type: "page",
        label: "First",
        path: "/first",
        iconName: "home",
      });
    });

    act(() => {
      result.current.addRecentItem({
        id: "second",
        type: "page",
        label: "Second",
        path: "/second",
        iconName: "home",
      });
    });

    expect(result.current.recentItems[0]?.id).toBe("second");
    expect(result.current.recentItems[1]?.id).toBe("first");
  });
});
