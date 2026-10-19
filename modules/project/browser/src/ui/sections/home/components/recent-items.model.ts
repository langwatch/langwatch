import type { RecentItemType } from "../../../../behavior/home-api.ts";
import type { HomeRecentItem } from "../../../../behavior/use-recent-items.ts";

/**
 * Group items by type — kept for consumers/tests even though the section now
 * renders one flat list (each row carries its own type label instead).
 */
export const groupItemsByType = (
  items: HomeRecentItem[],
): Map<RecentItemType, HomeRecentItem[]> => {
  const grouped = new Map<RecentItemType, HomeRecentItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.type) ?? [];
    grouped.set(item.type, [...existing, item]);
  }
  return grouped;
};
