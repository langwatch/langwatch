import { useMemo } from "react";

import { useAnalyticsEntry } from "../../../behavior/use-analytics-entry.ts";
import { useHasOrganizationLibrary } from "../../../behavior/use-product-home.ts";
import { useNavigationHost } from "../../../model/navigation-host.ts";
import { planManagementHref } from "../../../model/plan-management-href.ts";
import {
  MIN_CATEGORY_MATCH_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
} from "../model/command-bar-constants.ts";
import type { Command } from "../model/command-bar-types.ts";
import {
  actionCommands,
  createDashboardCommand,
  filterCommands,
  filterCommandsByFeatureFlags,
  filterCommandsByProjectNavigation,
  navigationCommands,
  supportCommands,
  themeCommands,
} from "../model/command-catalogue.ts";
import { getPageCommands } from "../model/command-page-commands.ts";
import { withLlmOpsProductLabel } from "../model/product-commands.ts";
import {
  useCommandFeatureFlags,
  useCommandProjectNavigation,
} from "./use-command-feature-flags.ts";
import { useProductCommands } from "./use-product-commands.ts";

export interface FilteredCommands {
  navigation: Command[];
  actions: Command[];
  support: Command[];
  theme: Command[];
  page: Command[];
}

const NAVIGATION_KEYWORDS = ["navigation", "navigate", "go to", "jump to", "pages"];
const ACTION_KEYWORDS = ["new", "create", "add new", "actions"];
const SUPPORT_KEYWORDS = ["support", "help", "docs", "documentation", "chat"];
const THEME_KEYWORDS = ["theme", "dark", "light", "mode", "appearance"];

/**
 * One category's commands for a query: all of them when the query names the
 * category itself (a close match), otherwise the keyword-filtered ones.
 */
function filterCategory({
  commands,
  query,
  keywords,
  minMatchLength,
}: {
  commands: Command[];
  query: string;
  keywords: string[];
  minMatchLength: number;
}): Command[] {
  if (!query.trim()) return [];
  const lowerQuery = query.toLowerCase().trim();
  const isSearchingCategory = keywords.some(
    (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= minMatchLength,
  );
  return isSearchingCategory ? commands : filterCommands(commands, query);
}

/**
 * The Analytics command, replaced by Dashboards (same address as the sidebar entry) once
 * the member's Dashboards is reachable; searches for analytics still find it.
 */
function analyticsCommand({
  command,
  path,
  leadsToDashboards,
}: {
  command: Command;
  path: ReturnType<typeof useAnalyticsEntry>["path"];
  leadsToDashboards: ReturnType<typeof useAnalyticsEntry>["leadsToDashboards"];
}): Command {
  if (!leadsToDashboards) return { ...command, path };
  return {
    ...command,
    label: "Dashboards",
    description: "Dashboards and charts",
    keywords: [...(command.keywords ?? []), "analytics", "dashboard", "dashboards"],
    path,
  };
}

/** "Open Chat" only on SaaS; the plans command links where plans are managed. */
function availableSupportCommands(isSaas: boolean | undefined): Command[] {
  return supportCommands
    .filter((cmd) => isSaas || cmd.id !== "action-open-chat")
    .map((cmd) =>
      cmd.id === "support-plans" ? { ...cmd, path: planManagementHref(isSaas ?? false) } : cmd,
    );
}

/**
 * Hook for filtering commands based on search query.
 * Handles category-based and keyword-based filtering.
 */
export function useFilteredCommands({
  query,
  isSaas,
}: {
  query: string;
  isSaas: boolean | undefined;
  projectId: string | undefined;
  isDevMode: boolean;
}): FilteredCommands {
  const host = useNavigationHost();
  const hasOpsAccess = host.opsAccess().hasAccess;
  const commandFeatureFlags = useCommandFeatureFlags();
  const projectNavigation = useCommandProjectNavigation();
  const productCommands = useProductCommands();
  const analyticsEntry = useAnalyticsEntry();
  const { path: analyticsPath, leadsToDashboards, isSettled: analyticsSettled } = analyticsEntry;
  const hasOrganizationLibrary = useHasOrganizationLibrary();
  // The project's Dashboards page has no create dialog, so without the library there is no action.
  const offersCreateDashboard = leadsToDashboards && hasOrganizationLibrary;

  const availableNavCommands = useMemo(() => {
    const commands = (
      hasOpsAccess
        ? navigationCommands
        : navigationCommands.filter((cmd) => !cmd.id.startsWith("nav-ops"))
    )
      // Same destination as the sidebar entry, and withheld while that entry waits.
      .filter((cmd) => cmd.id !== "nav-analytics" || analyticsSettled)
      .map((cmd) =>
        cmd.id === "nav-analytics"
          ? analyticsCommand({ command: cmd, path: analyticsPath, leadsToDashboards })
          : cmd,
      );
    return [
      ...withLlmOpsProductLabel(
        filterCommandsByProjectNavigation({
          commands: filterCommandsByFeatureFlags({ commands, flags: commandFeatureFlags }),
          navigation: projectNavigation,
        }),
      ),
      ...productCommands,
    ];
  }, [
    hasOpsAccess,
    commandFeatureFlags,
    projectNavigation,
    productCommands,
    analyticsPath,
    leadsToDashboards,
    analyticsSettled,
  ]);

  const filteredNavigation = useMemo(
    () =>
      filterCategory({
        commands: availableNavCommands,
        query,
        keywords: NAVIGATION_KEYWORDS,
        minMatchLength: MIN_CATEGORY_MATCH_LENGTH,
      }),
    [query, availableNavCommands],
  );

  const availableActionCommands = useMemo(() => {
    const commands = hasOpsAccess
      ? actionCommands
      : actionCommands.filter((cmd) => cmd.id !== "action-send-trace");
    const offered = filterCommandsByProjectNavigation({ commands, navigation: projectNavigation });
    return offersCreateDashboard ? [...offered, createDashboardCommand] : offered;
  }, [hasOpsAccess, projectNavigation, offersCreateDashboard]);

  const filteredActions = useMemo(
    () =>
      filterCategory({
        commands: availableActionCommands,
        query,
        keywords: ACTION_KEYWORDS,
        minMatchLength: MIN_SEARCH_QUERY_LENGTH,
      }),
    [query, availableActionCommands],
  );

  const filteredSupport = useMemo(
    () =>
      filterCategory({
        commands: availableSupportCommands(isSaas),
        query,
        keywords: SUPPORT_KEYWORDS,
        minMatchLength: MIN_SEARCH_QUERY_LENGTH,
      }),
    [query, isSaas],
  );

  const filteredTheme = useMemo(
    () =>
      filterCategory({
        commands: themeCommands,
        query,
        keywords: THEME_KEYWORDS,
        minMatchLength: MIN_SEARCH_QUERY_LENGTH,
      }),
    [query],
  );

  // Filter page-specific commands based on current route. The host answers
  // with the ADDRESS on screen; `getPageCommands` normalises the first segment
  // to `[project]` itself, so a concrete slug resolves to the pattern the page
  // registered under.
  const pathname = host.pathname();
  const filteredPage = useMemo(() => {
    if (!query.trim()) return [];
    const pageCommands = getPageCommands(pathname);
    return filterCommands(pageCommands, query);
  }, [query, pathname]);

  return {
    navigation: filteredNavigation,
    actions: filteredActions,
    support: filteredSupport,
    theme: filteredTheme,
    page: filteredPage,
  };
}
