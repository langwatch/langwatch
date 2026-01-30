import { useMemo } from "react";
import { Search, BookOpen } from "lucide-react";
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
import { findEasterEgg } from "../easterEggs";

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
  projectSlug: string | undefined,
): {
  allItems: ListItem[];
  recentItemsLimited: RecentItem[];
  searchInTracesItem: ListItem | null;
  searchInDocsItem: ListItem | null;
  easterEggItem: ListItem | null;
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

  // Create "Search in docs" item when query is long enough
  const searchInDocsItem = useMemo<ListItem | null>(() => {
    if (!query.trim() || query.trim().length < MIN_SEARCH_QUERY_LENGTH) {
      return null;
    }
    return {
      type: "command",
      data: {
        id: "action-search-docs",
        label: `Search "${query.trim()}" in docs`,
        icon: BookOpen,
        category: "navigation",
        externalUrl: `https://langwatch.ai/docs/introduction?search=${encodeURIComponent(query.trim())}`,
      } as Command,
    };
  }, [query]);

  // Easter egg item
  const easterEggItem = useMemo<ListItem | null>(() => {
    const egg = findEasterEgg(query);
    if (!egg) return null;
    return {
      type: "command",
      data: {
        id: egg.id,
        label: egg.label,
        icon: egg.icon,
        category: "actions",
      } as Command,
    };
  }, [query]);

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
      // Add easter egg item first if found
      if (easterEggItem) {
        items.push(easterEggItem);
      }
      // Add ID result if detected
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
      for (const cmd of filteredCommands.page) {
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
      // Add "Search in docs" after "Search in traces"
      if (searchInDocsItem) {
        items.push(searchInDocsItem);
      }
    }

    return items;
  }, [
    query,
    recentItemsLimited,
    easterEggItem,
    idResult,
    filteredCommands,
    searchResults,
    filteredProjects,
    searchInTracesItem,
    searchInDocsItem,
  ]);

  return {
    allItems,
    recentItemsLimited,
    searchInTracesItem,
    searchInDocsItem,
    easterEggItem,
  };
}
