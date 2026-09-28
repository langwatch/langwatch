import { useMemo } from "react";

import {
  MIN_CATEGORY_MATCH_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
} from "../model/command-bar-constants.ts";
import type { Command } from "../model/command-bar-types.ts";
import {
  actionCommands,
  filterCommands,
  filterCommandsByFeatureFlags,
  navigationCommands,
  supportCommands,
  themeCommands,
} from "../model/command-catalogue.ts";
import { getPageCommands } from "../model/command-page-commands.ts";
import { useNavigationHost } from "../model/navigation-host.ts";
import { planManagementHref } from "../model/plan-management-href.ts";
import { useCommandFeatureFlags } from "./use-command-feature-flags.ts";

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

  const availableNavCommands = useMemo(() => {
    const commands = hasOpsAccess
      ? navigationCommands
      : navigationCommands.filter((cmd) => !cmd.id.startsWith("nav-ops"));
    return filterCommandsByFeatureFlags({
      commands,
      flags: commandFeatureFlags,
    });
  }, [hasOpsAccess, commandFeatureFlags]);

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
    return hasOpsAccess
      ? actionCommands
      : actionCommands.filter((cmd) => cmd.id !== "action-send-trace");
  }, [hasOpsAccess]);

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
