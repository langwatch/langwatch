import { Box, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Folder, Lightbulb, Search } from "lucide-react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { Dialog } from "~/components/ui/dialog";
import { featureIcons, type FeatureKey } from "~/utils/featureIcons";
import {
  actionCommands,
  filterCommands,
  navigationCommands,
  topLevelNavigationCommands,
} from "./command-registry";
import { useCommandBar } from "./CommandBarContext";
import { useCommandSearch } from "./useCommandSearch";
import { useRecentItems, type TimeGroup } from "./useRecentItems";
import type { Command, RecentItem, SearchResult } from "./types";

/**
 * Icon color mapping for different item types.
 */
const iconColors: Record<string, string> = {
  home: "orange.400",
  analytics: "blue.400",
  traces: "green.400",
  messages: "green.400",
  simulations: "purple.400",
  scenarios: "purple.300",
  evaluations: "teal.400",
  experiments: "teal.300",
  annotations: "yellow.400",
  "annotations-all": "yellow.400",
  "annotations-inbox": "yellow.300",
  "annotations-queue": "yellow.300",
  prompts: "cyan.400",
  agents: "pink.400",
  workflows: "indigo.400",
  evaluators: "red.400",
  datasets: "blue.300",
  triggers: "orange.300",
  settings: "gray.400",
  "settings-members": "blue.400",
  "settings-teams": "blue.300",
  "settings-projects": "green.400",
  "settings-roles": "purple.400",
  "settings-model-providers": "orange.400",
  "settings-model-costs": "green.300",
  "settings-annotation-scores": "yellow.400",
  "settings-topic-clustering": "cyan.400",
  "settings-usage": "blue.400",
  "settings-subscription": "pink.400",
  "settings-authentication": "red.400",
  "settings-audit-log": "gray.400",
  "settings-license": "gray.400",
  prompt: "cyan.400",
  agent: "pink.400",
  dataset: "blue.300",
  workflow: "indigo.400",
  evaluator: "red.400",
  project: "orange.300",
  // Phase 2: New entity types
  trace: "green.400",
  span: "green.300",
  "simulation-run": "purple.400",
  scenario: "purple.300",
  experiment: "teal.300",
  trigger: "orange.300",
};

/**
 * Unified item type for keyboard navigation.
 */
type ListItem =
  | { type: "command"; data: Command }
  | { type: "search"; data: SearchResult }
  | { type: "recent"; data: RecentItem }
  | { type: "project"; data: { slug: string; name: string; orgTeam: string } };

/**
 * Tips to help users get the most out of LangWatch.
 */
const HINTS = [
  // Useful tips
  "Quick Jump! Paste a trace ID to teleport directly to that trace.",
  "Auto Grader! Use Evaluations to automatically score your LLM outputs.",
  "Stay Alert! Set up Triggers to get notified when issues occur.",
  "Instant Replay! Create Datasets from your traces for regression testing.",
  "Gold Stars! Use Annotations to label traces for fine-tuning.",
  "Stress Test! Try Simulations to test your agents with synthetic users.",
  "Version Control! Track prompt changes with the Prompts registry.",
  "Number Cruncher! Use Analytics to monitor costs and performance trends.",
  "Custom Judge! Set up custom Evaluators for domain-specific quality checks.",
  "Chain Gang! Use Workflows to chain evaluations together.",
  "Safety First! Use Guardrails to block harmful responses in real-time.",
  "Prompt Wizard! Use DSPy optimization to automatically find better prompts.",
  "Pick Your Poison! Choose from 40+ built-in evaluators or create your own.",
  "Thumbs Up! Capture user feedback with thumbs ratings to measure satisfaction.",
  "Lab Coat! Run Experiments to A/B test prompt variations and compare results.",
  "Always Watching! Set up Monitors to continuously score production traffic.",
  "Git Sync! Connect your Prompts registry to GitHub for version control.",
  "Data Factory! Generate synthetic datasets with AI to bootstrap your testing.",
  "Expert Mode! Set up annotation queues for structured human review workflows.",
  "Bridge Builder! Integrate with LangChain, LangGraph, CrewAI and 15+ frameworks.",
  "Your House! Self-host LangWatch on Docker or Kubernetes for full data control.",
  "Low Code! Connect n8n, Langflow, or Flowise for no-code LLM observability.",

  // Fun tips
  "Token Hoarder? Check Analytics to see which prompts are burning through your budget.",
  "Deja Vu! Create Datasets from production traces to replay that one weird edge case.",
  "Trust Issues? Use guardrail Evaluators to keep your AI from going rogue.",
  "Enter the Matrix! Test your agent with a simulated users before real ones show up.",
  "New to LangWatch? Feel free to ask for help. We don't bite.",
];

/**
 * Format a timestamp as a relative time string (e.g., "2m ago", "1h ago").
 */
function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Hints section showing tips to help users.
 */
function HintsSection() {
  // Pick a random hint on mount (stable for the session)
  const [hintIndex] = useState(() => Math.floor(Math.random() * HINTS.length));
  const hint = HINTS[hintIndex];

  return (
    <HStack
      borderTop="1px solid"
      borderColor="border.muted"
      px={4}
      py={2}
      gap={2}
      fontSize="12px"
      color="fg.muted"
    >
      <Box color="yellow.500" flexShrink={0}>
        <Lightbulb size={14} />
      </Box>
      <Text>
        <Text as="span" fontWeight="medium">
          Tip:
        </Text>{" "}
        {hint}
      </Text>
    </HStack>
  );
}

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
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= 3,
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
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= 2,
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
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= 3,
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
    return allRecent.slice(0, 5);
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
      if (query.trim().length >= 2) {
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

  // Get icon and color for an item
  const getIconInfo = (item: ListItem) => {
    let Icon;
    let colorKey = "";

    if (item.type === "command") {
      Icon = item.data.icon;
      colorKey = item.data.id.replace("nav-", "").replace("action-new-", "");
    } else if (item.type === "search") {
      Icon = item.data.icon;
      colorKey = item.data.type;
    } else if (item.type === "recent") {
      const featureKey = item.data.iconName as FeatureKey;
      if (featureIcons[featureKey]) {
        Icon = featureIcons[featureKey].icon;
      } else {
        switch (item.data.iconName) {
          case "prompt":
            Icon = featureIcons.prompts.icon;
            break;
          case "agent":
            Icon = featureIcons.agents.icon;
            break;
          case "dataset":
            Icon = featureIcons.datasets.icon;
            break;
          case "workflow":
            Icon = featureIcons.workflows.icon;
            break;
          case "evaluator":
            Icon = featureIcons.evaluators.icon;
            break;
          case "project":
            Icon = Folder;
            break;
          default:
            Icon = featureIcons.home.icon;
        }
      }
      colorKey = item.data.iconName;
    } else if (item.type === "project") {
      Icon = Folder;
      colorKey = "project";
    }

    return {
      Icon: Icon!,
      color: iconColors[colorKey] ?? "gray.400",
    };
  };

  // Render a single item row
  const renderItem = (item: ListItem, index: number) => {
    const isSelected = index === selectedIndex;
    const { Icon, color } = getIconInfo(item);

    let label = "";
    let description: string | undefined;

    if (item.type === "command") {
      label = item.data.label;
      description = item.data.description;
    } else if (item.type === "search") {
      label = item.data.label;
      description = item.data.description;
    } else if (item.type === "recent") {
      label = item.data.label;
      description = item.data.description;
    } else if (item.type === "project") {
      label = item.data.name;
      description = item.data.orgTeam;
    }

    return (
      <HStack
        key={
          item.type === "project"
            ? `project-${item.data.slug}`
            : item.type === "command"
              ? item.data.id
              : item.type === "search"
                ? item.data.id
                : item.data.id
        }
        px={4}
        py={1.5}
        cursor="pointer"
        borderRadius="md"
        marginX={2}
        bg={isSelected ? "bg.emphasized" : "transparent"}
        _hover={{ bg: "bg.muted" }}
        onClick={() => handleSelect(item)}
        onMouseEnter={() => setSelectedIndex(index)}
        gap={3}
      >
        <Box color={color} flexShrink={0}>
          <Icon size={18} />
        </Box>
        <HStack flex={1} gap={2} overflow="hidden">
          <Text
            fontSize="14px"
            fontWeight="medium"
            color="fg.default"
            whiteSpace="nowrap"
            overflow="hidden"
            textOverflow="ellipsis"
          >
            {label}
          </Text>
          {description && (
            <Text
              fontSize="12px"
              color="fg.subtle"
              whiteSpace="nowrap"
              overflow="hidden"
              textOverflow="ellipsis"
            >
              {description}
            </Text>
          )}
        </HStack>
        {/* Time ago for recent items */}
        {item.type === "recent" && (
          <Text fontSize="11px" color="fg.muted" flexShrink={0}>
            {formatTimeAgo(item.data.accessedAt)}
          </Text>
        )}
        {isSelected && (
          <Box color="fg.muted" flexShrink={0}>
            <CornerDownLeft size={14} />
          </Box>
        )}
      </HStack>
    );
  };

  // Render group with label
  const renderGroup = (
    label: string,
    items: ListItem[],
    startIndex: number,
  ) => {
    if (items.length === 0) return null;

    return (
      <VStack align="stretch" gap={0}>
        <Text
          fontSize="12px"
          fontWeight="normal"
          color="fg.muted"
          px={4}
          paddingTop={3}
          paddingBottom={1.5}
        >
          {label}
        </Text>
        {items.map((item, i) => renderItem(item, startIndex + i))}
      </VStack>
    );
  };

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
        width="680px"
        maxWidth="90vw"
        marginTop="12vh"
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
          {searchLoading && query.length >= 2 && (
            <Spinner size="sm" color="fg.muted" />
          )}
        </HStack>

        {/* Results */}
        <Box
          maxHeight="480px"
          overflowY="auto"
          paddingBottom={3}
          borderTop="1px solid"
          borderColor="border.muted"
        >
          {query === "" ? (
            <VStack align="stretch" gap={0}>
              {/* Recent items (up to 5) */}
              {recentItemsLimited.length > 0 &&
                renderGroup(
                  "Recent",
                  recentItemsLimited.map((d) => ({
                    type: "recent" as const,
                    data: d,
                  })),
                  getGroupIndex(
                    recentItemsLimited.map((d) => ({
                      type: "recent" as const,
                      data: d,
                    })),
                  ),
                )}
              {/* Top-level navigation commands */}
              {renderGroup(
                "Navigation",
                topLevelNavigationCommands.map((d) => ({
                  type: "command" as const,
                  data: d,
                })),
                getGroupIndex(
                  topLevelNavigationCommands.map((d) => ({
                    type: "command" as const,
                    data: d,
                  })),
                ),
              )}
            </VStack>
          ) : (
            <VStack align="stretch" gap={0}>
              {/* ID-based navigation result (shown immediately) */}
              {idResult &&
                renderGroup(
                  "Jump to ID",
                  [{ type: "search" as const, data: idResult }],
                  getGroupIndex([{ type: "search" as const, data: idResult }]),
                )}
              {filteredNavigation.length > 0 &&
                renderGroup(
                  "Navigation",
                  filteredNavigation.map((d) => ({
                    type: "command" as const,
                    data: d,
                  })),
                  getGroupIndex(
                    filteredNavigation.map((d) => ({
                      type: "command" as const,
                      data: d,
                    })),
                  ),
                )}
              {filteredActions.length > 0 &&
                renderGroup(
                  "Actions",
                  filteredActions.map((d) => ({
                    type: "command" as const,
                    data: d,
                  })),
                  getGroupIndex(
                    filteredActions.map((d) => ({
                      type: "command" as const,
                      data: d,
                    })),
                  ),
                )}
              {/* Loading indicator while searching */}
              {searchLoading && (
                <HStack px={4} py={3} gap={2} color="fg.muted">
                  <Spinner size="sm" />
                  <Text fontSize="sm">Searching...</Text>
                </HStack>
              )}
              {searchResults.length > 0 &&
                renderGroup(
                  "Search Results",
                  searchResults.map((d) => ({
                    type: "search" as const,
                    data: d,
                  })),
                  getGroupIndex(
                    searchResults.map((d) => ({
                      type: "search" as const,
                      data: d,
                    })),
                  ),
                )}
              {filteredProjects.length > 0 &&
                renderGroup(
                  "Switch Project",
                  filteredProjects.map((d) => ({
                    type: "project" as const,
                    data: d,
                  })),
                  getGroupIndex(
                    filteredProjects.map((d) => ({
                      type: "project" as const,
                      data: d,
                    })),
                  ),
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
