import { forwardRef, useMemo } from "react";
import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { CommandGroup } from "./CommandGroup";
import type { ListItem } from "../getIconInfo";
import type { Command, RecentItem, SearchResult } from "../types";
import type { FilteredProject } from "../hooks/useFilteredProjects";
import { COMMAND_BAR_MAX_HEIGHT } from "../constants";
import { topLevelNavigationCommands } from "../command-registry";

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
  searchResults: SearchResult[];
  filteredProjects: FilteredProject[];
  searchInTracesItem: ListItem | null;
  idResult: SearchResult | null;
  recentItemsLimited: RecentItem[];
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
    searchResults,
    filteredProjects,
    searchInTracesItem,
    idResult,
    recentItemsLimited,
    isLoading,
  },
  ref
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
    [recentItemsLimited]
  );

  // Build group configurations for query state
  const queryGroups = useMemo<GroupConfig[]>(() => {
    const groups: GroupConfig[] = [];

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

    if (searchInTracesItem) {
      groups.push({
        label: "Search Traces",
        items: [searchInTracesItem],
      });
    }

    return groups;
  }, [
    idResult,
    filteredNavigation,
    filteredActions,
    filteredSupport,
    filteredTheme,
    searchResults,
    filteredProjects,
    searchInTracesItem,
  ]);

  const groups = query === "" ? emptyQueryGroups : queryGroups;

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
      paddingBottom={3}
      borderTop="1px solid"
      borderColor="border.muted"
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
