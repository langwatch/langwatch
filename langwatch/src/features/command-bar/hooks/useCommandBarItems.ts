import { useMemo } from "react";
import { Search } from "lucide-react";
import type { ListItem } from "../getIconInfo";
import type { Command, RecentItem, SearchResult } from "../types";
import type { FilteredCommands } from "./useFilteredCommands";
import type { FilteredProject } from "./useFilteredProjects";
import { topLevelNavigationCommands } from "../command-registry";
import {
  MIN_SEARCH_QUERY_LENGTH,
  RECENT_ITEMS_DISPLAY_LIMIT,
} from "../constants";
import type { GroupedRecentItems } from "../useRecentItems";

/**
 * Hook that builds the flat list of all items for keyboard navigation and display.
 */
export function useCommandBarItems(
  query: string,
  filteredCommands: FilteredCommands,
  filteredProjects: FilteredProject[],
  searchResults: SearchResult[],
  idResult: SearchResult | null,
  groupedItems: GroupedRecentItems,
  projectSlug: string | undefined
): {
  allItems: ListItem[];
  recentItemsLimited: RecentItem[];
  searchInTracesItem: ListItem | null;
} {
  // Get top recent items across all time groups
  const recentItemsLimited = useMemo(() => {
    const allRecent = [
      ...groupedItems.today,
      ...groupedItems.yesterday,
      ...groupedItems.pastWeek,
      ...groupedItems.past30Days,
    ];
    return allRecent.slice(0, RECENT_ITEMS_DISPLAY_LIMIT);
  }, [groupedItems]);

  // Create "Search in traces" item when query is long enough
  const searchInTracesItem = useMemo<ListItem | null>(() => {
    if (!query.trim() || query.trim().length < MIN_SEARCH_QUERY_LENGTH) {
      return null;
    }
    // Don't create invalid path when projectSlug is missing
    if (!projectSlug) {
      return null;
    }
    return {
      type: "command",
      data: {
        id: "action-search-traces",
        label: `Search "${query.trim()}" in traces`,
        icon: Search,
        category: "navigation",
        path: `/${projectSlug}/messages?query=${encodeURIComponent(query.trim())}`,
      } as Command,
    };
  }, [query, projectSlug]);

  // Build flat list of all items for keyboard navigation
  const allItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    if (query === "") {
      // Add up to 5 recent items first
      for (const item of recentItemsLimited) {
        items.push({ type: "recent", data: item });
      }

      // Show only top-level navigation commands by default
      for (const cmd of topLevelNavigationCommands) {
        items.push({ type: "command", data: cmd });
      }
    } else {
      // Add ID result first if detected
      if (idResult) {
        items.push({ type: "search", data: idResult });
      }
      for (const cmd of filteredCommands.navigation) {
        items.push({ type: "command", data: cmd });
      }
      for (const cmd of filteredCommands.actions) {
        items.push({ type: "command", data: cmd });
      }
      for (const cmd of filteredCommands.support) {
        items.push({ type: "command", data: cmd });
      }
      for (const cmd of filteredCommands.theme) {
        items.push({ type: "command", data: cmd });
      }
      for (const result of searchResults) {
        items.push({ type: "search", data: result });
      }
      for (const proj of filteredProjects) {
        items.push({ type: "project", data: proj });
      }
      // Add "Search in traces" at the end
      if (searchInTracesItem) {
        items.push(searchInTracesItem);
      }
    }

    return items;
  }, [
    query,
    recentItemsLimited,
    idResult,
    filteredCommands,
    searchResults,
    filteredProjects,
    searchInTracesItem,
  ]);

  return { allItems, recentItemsLimited, searchInTracesItem };
}
