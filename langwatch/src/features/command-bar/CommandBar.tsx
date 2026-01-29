import { Box, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { Dialog } from "~/components/ui/dialog";
import {
  actionCommands,
  filterCommands,
  navigationCommands,
  topLevelNavigationCommands,
} from "./command-registry";
import { useCommandBar } from "./CommandBarContext";
import { useCommandSearch } from "./useCommandSearch";
import { useRecentItems } from "./useRecentItems";
import type { Command } from "./types";
import {
  COMMAND_BAR_MAX_HEIGHT,
  COMMAND_BAR_TOP_MARGIN,
  COMMAND_BAR_MAX_WIDTH,
  RECENT_ITEMS_DISPLAY_LIMIT,
  MIN_SEARCH_QUERY_LENGTH,
  MIN_CATEGORY_MATCH_LENGTH,
} from "./constants";
import { HintsSection } from "./components/HintsSection";
import { CommandGroup } from "./components/CommandGroup";
import type { ListItem } from "./getIconInfo";

/**
 * CommandBar component - global Cmd+K command palette.
 */
export function CommandBar() {
  const router = useRouter();
  const { isOpen, close, query, setQuery } = useCommandBar();
  const { project, organizations } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const {
    idResult,
    searchResults,
    isLoading: searchLoading,
  } = useCommandSearch(query);
  const { groupedItems, hasRecentItems, addRecentItem } = useRecentItems();

  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Detect platform for keyboard hints
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  // Filter commands based on query
  const filteredNavigation = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if searching for navigation category (must be a close match)
    const navKeywords = ["navigation", "navigate", "go to", "jump to", "pages"];
    const isSearchingCategory = navKeywords.some(
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_CATEGORY_MATCH_LENGTH,
    );

    if (isSearchingCategory) {
      return navigationCommands;
    }

    return filterCommands(navigationCommands, query);
  }, [query]);

  const filteredActions = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if searching for actions category (must be a close match)
    const actionKeywords = ["new", "create", "add new", "actions"];
    const isSearchingCategory = actionKeywords.some(
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_SEARCH_QUERY_LENGTH,
    );

    if (isSearchingCategory) {
      return actionCommands;
    }

    return filterCommands(actionCommands, query);
  }, [query]);

  // Filter projects based on query
  const filteredProjects = useMemo(() => {
    if (!organizations || !query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if user is searching for the category itself (must be a close match)
    const projectKeywords = [
      "switch project",
      "switch projects",
      "projects",
      "workspace",
      "workspaces",
    ];
    const isSearchingCategory = projectKeywords.some(
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_CATEGORY_MATCH_LENGTH,
    );

    const projects: Array<{
      slug: string;
      name: string;
      orgTeam: string;
    }> = [];

    for (const org of organizations) {
      for (const team of org.teams) {
        for (const proj of team.projects) {
          if (proj.slug === project?.slug) continue;

          // Show all projects if searching category, or filter by name/org/team
          if (
            isSearchingCategory ||
            proj.name.toLowerCase().includes(lowerQuery) ||
            org.name.toLowerCase().includes(lowerQuery) ||
            team.name.toLowerCase().includes(lowerQuery)
          ) {
            const orgTeam =
              team.name !== org.name ? `${org.name} / ${team.name}` : org.name;
            projects.push({ slug: proj.slug, name: proj.name, orgTeam });
          }
        }
      }
    }

    return projects;
  }, [organizations, project?.slug, query]);

  // Get top 5 recent items across all time groups
  const recentItemsLimited = useMemo(() => {
    const allRecent = [
      ...groupedItems.today,
      ...groupedItems.yesterday,
      ...groupedItems.pastWeek,
      ...groupedItems.past30Days,
    ];
    return allRecent.slice(0, RECENT_ITEMS_DISPLAY_LIMIT);
  }, [groupedItems]);

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
      // Add "Search in traces" as first navigation item when there's a query
      if (query.trim().length >= MIN_SEARCH_QUERY_LENGTH) {
        const projectSlug = project?.slug ?? "";
        items.push({
          type: "command",
          data: {
            id: "action-search-traces",
            label: `Search "${query.trim()}" in traces`,
            icon: Search,
            category: "navigation",
            path: `/${projectSlug}/messages?query=${encodeURIComponent(query.trim())}`,
          } as Command,
        });
      }
      for (const cmd of filteredNavigation) {
        items.push({ type: "command", data: cmd });
      }
      for (const cmd of filteredActions) {
        items.push({ type: "command", data: cmd });
      }
      for (const result of searchResults) {
        items.push({ type: "search", data: result });
      }
      for (const proj of filteredProjects) {
        items.push({ type: "project", data: proj });
      }
    }

    return items;
  }, [
    query,
    recentItemsLimited,
    idResult,
    filteredNavigation,
    filteredActions,
    searchResults,
    filteredProjects,
    project?.slug,
  ]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allItems.length, query]);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Handle item selection
  const handleSelect = useCallback(
    (item: ListItem, newTab = false) => {
      const projectSlug = project?.slug ?? "";

      const navigate = (path: string) => {
        if (newTab) {
          window.open(path, "_blank");
        } else {
          void router.push(path);
        }
        close();
      };

      if (item.type === "command") {
        const cmd = item.data;

        if (cmd.category === "navigation" && cmd.path) {
          // Extract parent context from description (e.g., "Settings → Teams" becomes "Settings")
          const parentContext = cmd.description?.includes("→")
            ? cmd.description.split("→")[0]?.trim()
            : undefined;
          addRecentItem({
            id: cmd.id,
            type: "page",
            label: cmd.label,
            description: parentContext,
            path: cmd.path.replace("[project]", projectSlug),
            iconName: cmd.id.replace("nav-", ""),
            projectSlug,
          });
        }

        if (cmd.path) {
          const path = cmd.path.replace("[project]", projectSlug);
          navigate(path);
          return;
        }

        switch (cmd.id) {
          case "action-new-agent":
            close();
            openDrawer("agentTypeSelector");
            break;
          case "action-new-evaluation":
            navigate(`/${projectSlug}/evaluations/new`);
            break;
          case "action-new-prompt":
            close();
            openDrawer("promptEditor");
            break;
          case "action-new-dataset":
            close();
            openDrawer("addOrEditDataset");
            break;
          case "action-new-scenario":
            navigate(`/${projectSlug}/simulations/scenarios`);
            break;
        }
      } else if (item.type === "search") {
        // Check if this should open a drawer instead of navigating
        if (item.data.drawerAction) {
          addRecentItem({
            id: item.data.id,
            type: "trace",
            label: item.data.label,
            description: item.data.type === "trace" ? "Trace" : undefined,
            path: item.data.path,
            iconName: item.data.type,
            projectSlug,
          });
          close();
          openDrawer(item.data.drawerAction.drawer, item.data.drawerAction.params);
        } else {
          addRecentItem({
            id: item.data.id,
            type: "entity",
            label: item.data.label,
            path: item.data.path,
            iconName: item.data.type,
            projectSlug,
          });
          navigate(item.data.path);
        }
      } else if (item.type === "recent") {
        addRecentItem({
          id: item.data.id,
          type: item.data.type,
          label: item.data.label,
          description: item.data.description,
          path: item.data.path,
          iconName: item.data.iconName,
          projectSlug: item.data.projectSlug,
        });
        // Open traces in drawer, navigate for everything else
        if (item.data.type === "trace") {
          // Extract trace ID from path (e.g., "/project/messages/traceId")
          const traceId = item.data.path.split("/").pop();
          if (traceId) {
            close();
            openDrawer("traceDetails", { traceId });
          }
        } else {
          navigate(item.data.path);
        }
      } else if (item.type === "project") {
        addRecentItem({
          id: `project-${item.data.slug}`,
          type: "project",
          label: item.data.name,
          path: `/${item.data.slug}`,
          iconName: "project",
          projectSlug: item.data.slug,
        });
        navigate(`/${item.data.slug}`);
      }
    },
    [project?.slug, router, close, openDrawer, addRecentItem],
  );

  // Copy link to clipboard
  const handleCopyLink = useCallback(() => {
    const item = allItems[selectedIndex];
    if (!item) return;

    let path = "";
    const projectSlug = project?.slug ?? "";

    if (item.type === "command" && item.data.path) {
      path = item.data.path.replace("[project]", projectSlug);
    } else if (item.type === "search") {
      path = item.data.path;
    } else if (item.type === "recent") {
      path = item.data.path;
    } else if (item.type === "project") {
      path = `/${item.data.slug}`;
    }

    if (path) {
      const url = `${window.location.origin}${path}`;
      void navigator.clipboard.writeText(url);
    }
  }, [allItems, selectedIndex, project?.slug]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (allItems[selectedIndex]) {
            handleSelect(allItems[selectedIndex], modKey);
          }
          break;
        case "l":
        case "L":
          if (modKey) {
            e.preventDefault();
            handleCopyLink();
          }
          break;
      }
    },
    [allItems, selectedIndex, handleSelect, handleCopyLink, isMac],
  );

  // Calculate indices for groups
  let currentIndex = 0;
  const getGroupIndex = (groupItems: ListItem[]) => {
    const start = currentIndex;
    currentIndex += groupItems.length;
    return start;
  };

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && close()}
      placement="top"
      motionPreset="slide-in-top"
    >
      <Dialog.Content
        width={COMMAND_BAR_MAX_WIDTH}
        maxWidth="90vw"
        marginTop={COMMAND_BAR_TOP_MARGIN}
        padding={0}
        overflow="hidden"
        borderRadius="xl"
      >
        {/* Search input */}
        <HStack px={4} py={3} gap={3}>
          <Box color="fg.muted" flexShrink={0}>
            <Search size={20} />
          </Box>
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Where would you like to go?"
            border="none"
            outline="none"
            boxShadow="none"
            background="transparent"
            fontSize="15px"
            flex={1}
            _placeholder={{ color: "fg.muted" }}
            _focus={{
              boxShadow: "none",
              outline: "none",
              background: "transparent",
            }}
          />
          {searchLoading && query.length >= MIN_SEARCH_QUERY_LENGTH && (
            <Spinner size="sm" color="fg.muted" />
          )}
        </HStack>

        {/* Results */}
        <Box
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
                    })),
                  )}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  onMouseEnter={setSelectedIndex}
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
                  })),
                )}
                selectedIndex={selectedIndex}
                onSelect={handleSelect}
                onMouseEnter={setSelectedIndex}
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
                  onSelect={handleSelect}
                  onMouseEnter={setSelectedIndex}
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
                    })),
                  )}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  onMouseEnter={setSelectedIndex}
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
                    })),
                  )}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  onMouseEnter={setSelectedIndex}
                />
              )}
              {/* Loading indicator while searching */}
              {searchLoading && (
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
                    })),
                  )}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  onMouseEnter={setSelectedIndex}
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
                    })),
                  )}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  onMouseEnter={setSelectedIndex}
                />
              )}
              {allItems.length === 0 && !searchLoading && (
                <Text textAlign="center" py={8} fontSize="sm" color="fg.muted">
                  No results found
                </Text>
              )}
            </VStack>
          )}
        </Box>

        {/* Tips section */}
        <HintsSection />

        {/* Keyboard shortcuts footer */}
        <HStack
          borderTop="1px solid"
          borderColor="border.muted"
          px={4}
          py={2.5}
          gap={5}
          fontSize="12px"
          color="fg.muted"
        >
          <HStack gap={1}>
            <Text opacity={0.5}>{isMac ? "⌘" : "Ctrl"}↵</Text>
            <Text>Open in new tab</Text>
          </HStack>
          <HStack gap={1}>
            <Text opacity={0.5}>{isMac ? "⌘" : "Ctrl"}L</Text>
            <Text>Copy link</Text>
          </HStack>
          <HStack gap={1}>
            <Text opacity={0.5}>↑↓</Text>
            <Text>Navigate</Text>
          </HStack>
          <HStack gap={1}>
            <Text opacity={0.5}>esc</Text>
            <Text>Close</Text>
          </HStack>
        </HStack>
      </Dialog.Content>
    </Dialog.Root>
  );
}
