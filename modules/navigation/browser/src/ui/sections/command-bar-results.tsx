import { Box, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { forwardRef, useMemo } from "react";

import { useTopLevelNavigationCommands } from "../../behavior/use-command-feature-flags.ts";
import type { FilteredProject } from "../../behavior/use-filtered-projects.ts";
import { COMMAND_BAR_MAX_HEIGHT } from "../../model/command-bar-constants.ts";
import type { Command, RecentItem, SearchResult } from "../../model/command-bar-types.ts";
import type { ListItem } from "../../model/command-icon-info.ts";
import { CommandGroup } from "../blocks/command-group.tsx";

interface CommandBarResultsProps {
  query: string;
  allItems: ListItem[];
  selectedIndex: number;
  onSelect: (item: ListItem, newTab?: boolean) => void;
  onMouseEnter: (index: number) => void;
  filteredNavigation: Command[];
  filteredActions: Command[];
  filteredSupport: Command[];
  filteredTheme: Command[];
  filteredPage: Command[];
  searchResults: SearchResult[];
  filteredProjects: FilteredProject[];
  searchInTracesItem: ListItem | null;
  searchInDocsItem: ListItem | null;
  idResult: SearchResult | null;
  recentItemsLimited: RecentItem[];
  easterEggItem: ListItem | null;
  askLangyItem: ListItem | null;
  isLoading: boolean;
  /**
   * Whether a line marks the boundary with the field above the list. True
   * where the field and the list share one card, false where the list is its
   * own panel and already carries an edge of its own.
   */
  showTopDivider: boolean;
}

interface GroupConfig {
  label: string;
  items: ListItem[];
}

function groupOf({ label, items }: { label: string; items: ListItem[] }): GroupConfig[] {
  return items.length > 0 ? [{ label, items }] : [];
}

function commandsOf(commands: Command[]): ListItem[] {
  return commands.map((d): ListItem => ({ type: "command", data: d }));
}

function queryGroupsOf({
  easterEggItem,
  idResult,
  filteredNavigation,
  filteredActions,
  filteredSupport,
  filteredTheme,
  filteredPage,
  searchResults,
  filteredProjects,
}: {
  easterEggItem: ListItem | null;
  idResult: SearchResult | null;
  filteredNavigation: Command[];
  filteredActions: Command[];
  filteredSupport: Command[];
  filteredTheme: Command[];
  filteredPage: Command[];
  searchResults: SearchResult[];
  filteredProjects: FilteredProject[];
}): GroupConfig[] {
  return [
    // Easter egg at the very top
    ...groupOf({ label: "Easter Egg", items: easterEggItem ? [easterEggItem] : [] }),
    ...groupOf({
      label: "Jump to ID",
      items: idResult ? [{ type: "search", data: idResult }] : [],
    }),
    ...groupOf({ label: "Navigation", items: commandsOf(filteredNavigation) }),
    ...groupOf({ label: "Actions", items: commandsOf(filteredActions) }),
    ...groupOf({ label: "Help & Support", items: commandsOf(filteredSupport) }),
    ...groupOf({ label: "Theme", items: commandsOf(filteredTheme) }),
    ...groupOf({ label: "Page Actions", items: commandsOf(filteredPage) }),
    ...groupOf({
      label: "Search Results",
      items: searchResults.map((d): ListItem => ({ type: "search", data: d })),
    }),
    ...groupOf({
      label: "Switch Project",
      items: filteredProjects.map((d): ListItem => ({ type: "project", data: d })),
    }),
  ];
}

/**
 * Ask Langy leads an empty bar; while typing it sits under the matches and
 * above the fallbacks. Mirrors `useCommandBarItems`'s order, or the keyboard
 * index disagrees with the screen.
 */
function orderedGroups({
  query,
  emptyQueryGroups,
  queryGroups,
  askLangyItem,
  searchInTracesItem,
  searchInDocsItem,
}: {
  query: string;
  emptyQueryGroups: GroupConfig[];
  queryGroups: GroupConfig[];
  askLangyItem: ListItem | null;
  searchInTracesItem: ListItem | null;
  searchInDocsItem: ListItem | null;
}): GroupConfig[] {
  const askGroup = groupOf({ label: "Ask Langy", items: askLangyItem ? [askLangyItem] : [] });
  if (query === "") return [...askGroup, ...emptyQueryGroups];
  return [
    ...queryGroups,
    ...askGroup,
    ...groupOf({ label: "Search Traces", items: searchInTracesItem ? [searchInTracesItem] : [] }),
    ...groupOf({ label: "Search Docs", items: searchInDocsItem ? [searchInDocsItem] : [] }),
  ];
}

/**
 * Results section component for the command bar.
 * Renders all command groups with proper indexing.
 */
export const CommandBarResults = forwardRef<HTMLDivElement, CommandBarResultsProps>(
  function CommandBarResults(
    {
      query,
      allItems,
      selectedIndex,
      onSelect,
      onMouseEnter,
      filteredNavigation,
      filteredActions,
      filteredSupport,
      filteredTheme,
      filteredPage,
      searchResults,
      filteredProjects,
      searchInTracesItem,
      searchInDocsItem,
      idResult,
      recentItemsLimited,
      easterEggItem,
      askLangyItem,
      isLoading,
      showTopDivider,
    },
    ref,
  ) {
    const topLevelNavigation = useTopLevelNavigationCommands();

    // Build group configurations for empty query state
    const emptyQueryGroups = useMemo<GroupConfig[]>(
      () => [
        {
          label: "Recent",
          items: recentItemsLimited.map((d) => ({
            type: "recent" as const,
            data: d,
          })),
        },
        {
          label: "Navigation",
          items: topLevelNavigation.map((d) => ({
            type: "command" as const,
            data: d,
          })),
        },
      ],
      [recentItemsLimited, topLevelNavigation],
    );

    const queryGroups = useMemo<GroupConfig[]>(
      () =>
        queryGroupsOf({
          easterEggItem,
          idResult,
          filteredNavigation,
          filteredActions,
          filteredSupport,
          filteredTheme,
          filteredPage,
          searchResults,
          filteredProjects,
        }),
      [
        easterEggItem,
        idResult,
        filteredNavigation,
        filteredActions,
        filteredSupport,
        filteredTheme,
        filteredPage,
        searchResults,
        filteredProjects,
      ],
    );

    const groups = useMemo<GroupConfig[]>(
      () =>
        orderedGroups({
          query,
          emptyQueryGroups,
          queryGroups,
          askLangyItem,
          searchInTracesItem,
          searchInDocsItem,
        }),
      [query, emptyQueryGroups, queryGroups, askLangyItem, searchInTracesItem, searchInDocsItem],
    );

    // Render groups with running index calculation
    const renderGroups = () => {
      let currentIndex = 0;

      return groups
        .filter((group) => group.items.length > 0)
        .map((group) => {
          const startIndex = currentIndex;
          currentIndex += group.items.length;

          return (
            <CommandGroup
              key={group.label}
              label={group.label}
              items={group.items}
              startIndex={startIndex}
              selectedIndex={selectedIndex}
              onSelect={onSelect}
              onMouseEnter={onMouseEnter}
            />
          );
        });
    };

    return (
      <Box
        ref={ref}
        data-testid="command-bar-results"
        maxHeight={COMMAND_BAR_MAX_HEIGHT}
        overflowY="auto"
        paddingBottom={2.5}
        {...(showTopDivider ? { borderTop: "1px solid", borderColor: "border.subtle" } : {})}
      >
        <VStack align="stretch" gap={0}>
          {renderGroups()}
          {/* Loading indicator while searching */}
          {query !== "" && isLoading && (
            <HStack px={4} py={3} gap={2} color="fg.muted">
              <Spinner size="sm" />
              <Text fontSize="sm">Searching...</Text>
            </HStack>
          )}
          {query !== "" && allItems.length === 0 && !isLoading && (
            <Text textAlign="center" py={8} fontSize="sm" color="fg.muted">
              No results found
            </Text>
          )}
        </VStack>
      </Box>
    );
  },
);
