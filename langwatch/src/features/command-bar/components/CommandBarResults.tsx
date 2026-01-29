import { forwardRef } from "react";
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
      searchResults,
      filteredProjects,
      searchInTracesItem,
      idResult,
      recentItemsLimited,
      isLoading,
    },
    ref
  ) {
    // Calculate indices for groups
    let currentIndex = 0;
    const getGroupIndex = (groupItems: ListItem[]) => {
      const start = currentIndex;
      currentIndex += groupItems.length;
      return start;
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
        {query === "" ? (
          <VStack align="stretch" gap={0}>
            {/* Recent items (up to 5) */}
            {recentItemsLimited.length > 0 && (
              <CommandGroup
                label="Recent"
                items={recentItemsLimited.map((d) => ({
                  type: "recent" as const,
                  data: d,
                }))}
                startIndex={getGroupIndex(
                  recentItemsLimited.map((d) => ({
                    type: "recent" as const,
                    data: d,
                  }))
                )}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
              />
            )}
            {/* Top-level navigation commands */}
            <CommandGroup
              label="Navigation"
              items={topLevelNavigationCommands.map((d) => ({
                type: "command" as const,
                data: d,
              }))}
              startIndex={getGroupIndex(
                topLevelNavigationCommands.map((d) => ({
                  type: "command" as const,
                  data: d,
                }))
              )}
              selectedIndex={selectedIndex}
              onSelect={onSelect}
              onMouseEnter={onMouseEnter}
            />
          </VStack>
        ) : (
          <VStack align="stretch" gap={0}>
            {/* ID-based navigation result (shown immediately) */}
            {idResult && (
              <CommandGroup
                label="Jump to ID"
                items={[{ type: "search" as const, data: idResult }]}
                startIndex={getGroupIndex([
                  { type: "search" as const, data: idResult },
                ])}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
              />
            )}
            {filteredNavigation.length > 0 && (
              <CommandGroup
                label="Navigation"
                items={filteredNavigation.map((d) => ({
                  type: "command" as const,
                  data: d,
                }))}
                startIndex={getGroupIndex(
                  filteredNavigation.map((d) => ({
                    type: "command" as const,
                    data: d,
                  }))
                )}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
              />
            )}
            {filteredActions.length > 0 && (
              <CommandGroup
                label="Actions"
                items={filteredActions.map((d) => ({
                  type: "command" as const,
                  data: d,
                }))}
                startIndex={getGroupIndex(
                  filteredActions.map((d) => ({
                    type: "command" as const,
                    data: d,
                  }))
                )}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
              />
            )}
            {filteredSupport.length > 0 && (
              <CommandGroup
                label="Help & Support"
                items={filteredSupport.map((d) => ({
                  type: "command" as const,
                  data: d,
                }))}
                startIndex={getGroupIndex(
                  filteredSupport.map((d) => ({
                    type: "command" as const,
                    data: d,
                  }))
                )}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
              />
            )}
            {filteredTheme.length > 0 && (
              <CommandGroup
                label="Theme"
                items={filteredTheme.map((d) => ({
                  type: "command" as const,
                  data: d,
                }))}
                startIndex={getGroupIndex(
                  filteredTheme.map((d) => ({
                    type: "command" as const,
                    data: d,
                  }))
                )}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
              />
            )}
            {/* Loading indicator while searching */}
            {isLoading && (
              <HStack px={4} py={3} gap={2} color="fg.muted">
                <Spinner size="sm" />
                <Text fontSize="sm">Searching...</Text>
              </HStack>
            )}
            {searchResults.length > 0 && (
              <CommandGroup
                label="Search Results"
                items={searchResults.map((d) => ({
                  type: "search" as const,
                  data: d,
                }))}
                startIndex={getGroupIndex(
                  searchResults.map((d) => ({
                    type: "search" as const,
                    data: d,
                  }))
                )}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
              />
            )}
            {filteredProjects.length > 0 && (
              <CommandGroup
                label="Switch Project"
                items={filteredProjects.map((d) => ({
                  type: "project" as const,
                  data: d,
                }))}
                startIndex={getGroupIndex(
                  filteredProjects.map((d) => ({
                    type: "project" as const,
                    data: d,
                  }))
                )}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
              />
            )}
            {/* Search in traces - shown at the end */}
            {searchInTracesItem && (
              <CommandGroup
                label="Search Traces"
                items={[searchInTracesItem]}
                startIndex={getGroupIndex([searchInTracesItem])}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
              />
            )}
            {allItems.length === 0 && !isLoading && (
              <Text textAlign="center" py={8} fontSize="sm" color="fg.muted">
                No results found
              </Text>
            )}
          </VStack>
        )}
      </Box>
    );
  }
);
