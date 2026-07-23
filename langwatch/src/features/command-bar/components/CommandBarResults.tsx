import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { forwardRef, useMemo } from "react";
import { topLevelNavigationCommands } from "../command-registry";
import { COMMAND_BAR_MAX_HEIGHT } from "../constants";
import type { ListItem } from "../getIconInfo";
import type { FilteredProject } from "../hooks/useFilteredProjects";
import type { Command, RecentItem, SearchResult } from "../types";
import { CommandGroup } from "./CommandGroup";

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
}

interface GroupConfig {
  label: string;
  items: ListItem[];
}

/**
 * Results section component for the command bar.
 * Renders all command groups with proper indexing.
 */
export const CommandBarResults = forwardRef<
  HTMLDivElement,
  CommandBarResultsProps
>(function CommandBarResults(
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
  },
  ref,
) {
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
        items: topLevelNavigationCommands.map((d) => ({
          type: "command" as const,
          data: d,
        })),
      },
    ],
    [recentItemsLimited],
  );

  // Build group configurations for query state
  const queryGroups = useMemo<GroupConfig[]>(() => {
    const groups: GroupConfig[] = [];

    // Easter egg at the very top
    if (easterEggItem) {
      groups.push({
        label: "Easter Egg",
        items: [easterEggItem],
      });
    }

    if (idResult) {
      groups.push({
        label: "Jump to ID",
        items: [{ type: "search" as const, data: idResult }],
      });
    }

    if (filteredNavigation.length > 0) {
      groups.push({
        label: "Navigation",
        items: filteredNavigation.map((d) => ({
          type: "command" as const,
          data: d,
        })),
      });
    }

    if (filteredActions.length > 0) {
      groups.push({
        label: "Actions",
        items: filteredActions.map((d) => ({
          type: "command" as const,
          data: d,
        })),
      });
    }

    if (filteredSupport.length > 0) {
      groups.push({
        label: "Help & Support",
        items: filteredSupport.map((d) => ({
          type: "command" as const,
          data: d,
        })),
      });
    }

    if (filteredTheme.length > 0) {
      groups.push({
        label: "Theme",
        items: filteredTheme.map((d) => ({
          type: "command" as const,
          data: d,
        })),
      });
    }

    if (filteredPage.length > 0) {
      groups.push({
        label: "Page Actions",
        items: filteredPage.map((d) => ({
          type: "command" as const,
          data: d,
        })),
      });
    }

    if (searchResults.length > 0) {
      groups.push({
        label: "Search Results",
        items: searchResults.map((d) => ({
          type: "search" as const,
          data: d,
        })),
      });
    }

    if (filteredProjects.length > 0) {
      groups.push({
        label: "Switch Project",
        items: filteredProjects.map((d) => ({
          type: "project" as const,
          data: d,
        })),
      });
    }

    return groups;
  }, [
    easterEggItem,
    idResult,
    filteredNavigation,
    filteredActions,
    filteredSupport,
    filteredTheme,
    filteredPage,
    searchResults,
    filteredProjects,
  ]);

  /**
   * The two things we can always offer, for any string at all. They are not
   * matches, and must never outrank one — see the ordering note in
   * `useCommandBarItems`, which this has to mirror exactly or the running
   * keyboard index stops agreeing with what is on screen.
   */
  const fallbackGroups = useMemo<GroupConfig[]>(() => {
    const groups: GroupConfig[] = [];
    if (searchInTracesItem) {
      groups.push({ label: "Search Traces", items: [searchInTracesItem] });
    }
    if (searchInDocsItem) {
      groups.push({ label: "Search Docs", items: [searchInDocsItem] });
    }
    return groups;
  }, [searchInTracesItem, searchInDocsItem]);

  // Ask Langy leads on an empty bar; while typing it sits under the real
  // matches and above the fallbacks.
  const groups = useMemo<GroupConfig[]>(() => {
    const askGroup: GroupConfig | null = askLangyItem
      ? { label: "Ask Langy", items: [askLangyItem] }
      : null;
    if (query === "") {
      return askGroup ? [askGroup, ...emptyQueryGroups] : emptyQueryGroups;
    }
    return [
      ...queryGroups,
      ...(askGroup ? [askGroup] : []),
      ...fallbackGroups,
    ];
  }, [query, emptyQueryGroups, queryGroups, askLangyItem, fallbackGroups]);

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
      maxHeight={COMMAND_BAR_MAX_HEIGHT}
      overflowY="auto"
      paddingBottom={2.5}
      borderTop="1px solid"
      borderColor="border.subtle"
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
});
