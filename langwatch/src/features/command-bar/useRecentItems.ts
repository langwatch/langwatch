import { useCallback, useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { RecentItem, RecentItemType } from "./types";
import { RecentItemSchema } from "./types";
import { MAX_RECENT_ITEMS } from "./constants";

const STORAGE_KEY = "langwatch-recent-items";

/**
 * Time groupings for recent items.
 */
export type TimeGroup = "today" | "yesterday" | "pastWeek" | "past30Days";

export interface GroupedRecentItems {
  today: RecentItem[];
  yesterday: RecentItem[];
  pastWeek: RecentItem[];
  past30Days: RecentItem[];
}

/**
 * Get the time group for a given timestamp.
 */
function getTimeGroup(timestamp: number): TimeGroup {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;

  const diff = now - timestamp;

  if (diff < dayMs) return "today";
  if (diff < 2 * dayMs) return "yesterday";
  if (diff < 7 * dayMs) return "pastWeek";
  return "past30Days";
}

/**
 * Hook for tracking recently accessed items with localStorage persistence.
 * Items are stored with timestamps and grouped by time for display.
 */
export function useRecentItems() {
  const [recentItems, setRecentItems] = useLocalStorage<RecentItem[]>(
    STORAGE_KEY,
    []
  );

  /**
   * Add an item to recent history.
   * Updates existing item's timestamp if already present.
   */
  const addRecentItem = useCallback(
    (item: Omit<RecentItem, "accessedAt">) => {
      setRecentItems((prev) => {
        // Remove existing item if present
        const filtered = prev.filter((i) => i.id !== item.id);

        // Add new item at the beginning with current timestamp
        const newItem: RecentItem = {
          ...item,
          accessedAt: Date.now(),
        };

        const updated = [newItem, ...filtered];

        // Prune to max items
        return updated.slice(0, MAX_RECENT_ITEMS);
      });
    },
    [setRecentItems]
  );

  /**
   * Clear all recent items.
   */
  const clearRecentItems = useCallback(() => {
    setRecentItems([]);
  }, [setRecentItems]);

  /**
   * Get recent items grouped by time period.
   * Validates localStorage data and filters out items older than 30 days.
   */
  const groupedItems = useMemo<GroupedRecentItems>(() => {
    // Validate localStorage data
    const parseResult = RecentItemSchema.array().safeParse(recentItems);
    const safeItems = parseResult.success ? parseResult.data : [];

    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    // Filter out items older than 30 days
    const validItems = safeItems.filter(
      (item) => now - item.accessedAt < thirtyDaysMs
    );

    const groups: GroupedRecentItems = {
      today: [],
      yesterday: [],
      pastWeek: [],
      past30Days: [],
    };

    for (const item of validItems) {
      const group = getTimeGroup(item.accessedAt);
      groups[group].push(item);
    }

    return groups;
  }, [recentItems]);

  /**
   * Check if there are any recent items to display.
   */
  const hasRecentItems = useMemo(() => {
    return (
      groupedItems.today.length > 0 ||
      groupedItems.yesterday.length > 0 ||
      groupedItems.pastWeek.length > 0 ||
      groupedItems.past30Days.length > 0
    );
  }, [groupedItems]);

  return {
    recentItems,
    groupedItems,
    hasRecentItems,
    addRecentItem,
    clearRecentItems,
  };
}
