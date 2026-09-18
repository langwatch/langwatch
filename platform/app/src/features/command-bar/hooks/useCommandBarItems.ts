import { BookOpen, Search, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { topLevelNavigationCommands } from "../command-registry";
import {
  MIN_SEARCH_QUERY_LENGTH,
  RECENT_ITEMS_DISPLAY_LIMIT,
} from "../constants";
import { findEasterEgg } from "../easterEggs";
import type { ListItem } from "../getIconInfo";
import type { Command, RecentItem, SearchResult } from "../types";
import type { GroupedRecentItems } from "../useRecentItems";
import type { FilteredCommands } from "./useFilteredCommands";
import type { FilteredProject } from "./useFilteredProjects";

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
  langyEnabled: boolean,
): {
  allItems: ListItem[];
  recentItemsLimited: RecentItem[];
  searchInTracesItem: ListItem | null;
  searchInDocsItem: ListItem | null;
  easterEggItem: ListItem | null;
  askLangyItem: ListItem | null;
} {
  const availableTopLevelNav = topLevelNavigationCommands;

  // The "Ask Langy" activation — the command bar's door into Langy. Synthesized
  // (not a static registry command) so it can carry the live query and only
  // appears where Langy can actually open: a real project, and the user in the
  // rollout (langyEnabled mirrors useShowLangy). With a typed question,
  // selecting it hands the question straight to the panel in one Enter; on an
  // empty bar it flips the field into Langy's composer instead — see
  // CommandPalette.handleSelect. The hint tells each apart, so the row promises
  // exactly what selecting it does.
  const askLangyItem = useMemo<ListItem | null>(() => {
    if (!langyEnabled || !projectSlug) return null;
    const trimmed = query.trim();
    return {
      type: "command",
      data: {
        id: "action-ask-langy",
        label: trimmed ? `Ask Langy: "${trimmed}"` : "Ask Langy",
        description: trimmed
          ? "Hand this question to Langy"
          : "Ask about the project in plain language",
        icon: Sparkles,
        category: "actions",
        keywords: ["langy", "ask", "ai", "assistant", "chat", "help"],
      } as Command,
    };
  }, [langyEnabled, projectSlug, query]);

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
        path: `/${projectSlug}/traces#all-traces?q=${encodeURIComponent(query.trim())}`,
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
      // On an empty bar Ask Langy LEADS — nothing competes for index 0, so
      // "Cmd+K, Enter" is the fast path into the assistant.
      if (askLangyItem) {
        items.push(askLangyItem);
      }

      // Add up to 5 recent items first
      for (const item of recentItemsLimited) {
        items.push({ type: "recent", data: item });
      }

      // Show only top-level navigation commands by default
      for (const cmd of availableTopLevelNav) {
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
      // Ask Langy sits under the real MATCHES and above the FALLBACKS.
      //
      // It used to trail everything, which sounds like the same rule but is
      // not: "Search for X in traces" and "in docs" are offered for literally
      // any string, so they are not matches at all — they are the two things
      // we can always say. Ranking them above Langy meant typing a plain
      // question and pressing Enter ran a substring search for that question,
      // which is never what someone typing a question meant.
      //
      // Below genuine matches, though. A typed page name, a pasted id or a
      // project still owns index 0, so Enter navigates the way it always did.
      if (askLangyItem) {
        items.push(askLangyItem);
      }
      if (searchInTracesItem) {
        items.push(searchInTracesItem);
      }
      if (searchInDocsItem) {
        items.push(searchInDocsItem);
      }
    }

    return items;
  }, [
    query,
    recentItemsLimited,
    availableTopLevelNav,
    askLangyItem,
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
    askLangyItem,
  };
}
