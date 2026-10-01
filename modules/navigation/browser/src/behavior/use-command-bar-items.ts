import { BookOpen, Search, Sparkles } from "lucide-react";
import { useMemo } from "react";

import {
  MIN_SEARCH_QUERY_LENGTH,
  RECENT_ITEMS_DISPLAY_LIMIT,
} from "../model/command-bar-constants.ts";
import type { Command, RecentItem, SearchResult } from "../model/command-bar-types.ts";
import { findEasterEgg } from "../model/command-easter-eggs.ts";
import type { ListItem } from "../model/command-icon-info.ts";
import { useTopLevelNavigationCommands } from "./use-command-feature-flags.ts";
import type { FilteredCommands } from "./use-filtered-commands.ts";
import type { FilteredProject } from "./use-filtered-projects.ts";
import type { GroupedRecentItems } from "./use-recent-items.ts";

function askLangyItemFor({
  langyEnabled,
  projectSlug,
  query,
}: {
  langyEnabled: boolean;
  projectSlug: string | undefined;
  query: string;
}): ListItem | null {
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
}

function searchInTracesItemFor({
  query,
  projectSlug,
}: {
  query: string;
  projectSlug: string | undefined;
}): ListItem | null {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
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
}

function searchInDocsItemFor(query: string): ListItem | null {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
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
}

function easterEggItemFor(query: string): ListItem | null {
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
}

function present(item: ListItem | null): ListItem[] {
  return item ? [item] : [];
}

function commandItems(commands: Command[]): ListItem[] {
  return commands.map((cmd): ListItem => ({ type: "command", data: cmd }));
}

/**
 * On an empty bar Ask Langy LEADS — nothing competes for index 0, so
 * "Cmd+K, Enter" is the fast path into the assistant — then recent items and
 * the top-level navigation commands.
 */
function emptyQueryItems({
  askLangyItem,
  recentItemsLimited,
  availableTopLevelNav,
}: {
  askLangyItem: ListItem | null;
  recentItemsLimited: RecentItem[];
  availableTopLevelNav: Command[];
}): ListItem[] {
  return [
    ...present(askLangyItem),
    ...recentItemsLimited.map((item): ListItem => ({ type: "recent", data: item })),
    ...commandItems(availableTopLevelNav),
  ];
}

/**
 * Ask Langy sits under the real MATCHES and above the FALLBACKS: "Search for X
 * in traces" and "in docs" are offered for literally any string, so they are
 * not matches at all — they are the two things we can always say.
 */
function queryItems({
  easterEggItem,
  idResult,
  filteredCommands,
  searchResults,
  filteredProjects,
  askLangyItem,
  searchInTracesItem,
  searchInDocsItem,
}: {
  easterEggItem: ListItem | null;
  idResult: SearchResult | null;
  filteredCommands: FilteredCommands;
  searchResults: SearchResult[];
  filteredProjects: FilteredProject[];
  askLangyItem: ListItem | null;
  searchInTracesItem: ListItem | null;
  searchInDocsItem: ListItem | null;
}): ListItem[] {
  return [
    ...present(easterEggItem),
    ...(idResult ? [{ type: "search", data: idResult } satisfies ListItem] : []),
    ...commandItems(filteredCommands.navigation),
    ...commandItems(filteredCommands.actions),
    ...commandItems(filteredCommands.support),
    ...commandItems(filteredCommands.theme),
    ...commandItems(filteredCommands.page),
    ...searchResults.map((result): ListItem => ({ type: "search", data: result })),
    ...filteredProjects.map((proj): ListItem => ({ type: "project", data: proj })),
    ...present(askLangyItem),
    ...present(searchInTracesItem),
    ...present(searchInDocsItem),
  ];
}

/**
 * Hook that builds the flat list of all items for keyboard navigation and display.
 */
export function useCommandBarItems({
  query,
  filteredCommands,
  filteredProjects,
  searchResults,
  idResult,
  groupedItems,
  projectSlug,
  langyEnabled,
}: {
  query: string;
  filteredCommands: FilteredCommands;
  filteredProjects: FilteredProject[];
  searchResults: SearchResult[];
  idResult: SearchResult | null;
  groupedItems: GroupedRecentItems;
  projectSlug: string | undefined;
  langyEnabled: boolean;
}): {
  allItems: ListItem[];
  recentItemsLimited: RecentItem[];
  searchInTracesItem: ListItem | null;
  searchInDocsItem: ListItem | null;
  easterEggItem: ListItem | null;
  askLangyItem: ListItem | null;
} {
  const availableTopLevelNav = useTopLevelNavigationCommands();

  // The "Ask Langy" activation — the command bar's door into Langy. Synthesized (not a static
  // registry command) so it can carry the live query and only appears where Langy can actually
  // open: a real project, and the user in the rollout (langyEnabled mirrors useShowLangy).
  const askLangyItem = useMemo<ListItem | null>(
    () => askLangyItemFor({ langyEnabled, projectSlug, query }),
    [langyEnabled, projectSlug, query],
  );

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
  const searchInTracesItem = useMemo<ListItem | null>(
    () => searchInTracesItemFor({ query, projectSlug }),
    [query, projectSlug],
  );

  // Create "Search in docs" item when query is long enough
  const searchInDocsItem = useMemo<ListItem | null>(() => searchInDocsItemFor(query), [query]);

  // Easter egg item
  const easterEggItem = useMemo<ListItem | null>(() => easterEggItemFor(query), [query]);

  // Build flat list of all items for keyboard navigation
  const allItems = useMemo<ListItem[]>(
    () =>
      query === ""
        ? emptyQueryItems({ askLangyItem, recentItemsLimited, availableTopLevelNav })
        : queryItems({
            easterEggItem,
            idResult,
            filteredCommands,
            searchResults,
            filteredProjects,
            askLangyItem,
            searchInTracesItem,
            searchInDocsItem,
          }),
    [
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
    ],
  );

  return {
    allItems,
    recentItemsLimited,
    searchInTracesItem,
    searchInDocsItem,
    easterEggItem,
    askLangyItem,
  };
}
