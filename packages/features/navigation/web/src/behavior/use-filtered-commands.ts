import { useMemo } from "react";
import { useNavigationHost } from "../model/navigation-host";
import { planManagementHref } from "../model/plan-management-href";
import {
  actionCommands,
  filterCommands,
  filterCommandsByFeatureFlags,
  navigationCommands,
  supportCommands,
  themeCommands,
} from "../model/command-catalogue";
import { MIN_CATEGORY_MATCH_LENGTH, MIN_SEARCH_QUERY_LENGTH } from "../model/command-bar-constants";
import { getPageCommands } from "../model/command-page-commands";
import type { Command } from "../model/command-bar-types";
import { useCommandFeatureFlags } from "./use-command-feature-flags";

export interface FilteredCommands {
  navigation: Command[];
  actions: Command[];
  support: Command[];
  theme: Command[];
  page: Command[];
}

/**
 * Hook for filtering commands based on search query.
 * Handles category-based and keyword-based filtering.
 */
export function useFilteredCommands(
  query: string,
  isSaas: boolean | undefined,
  projectId: string | undefined,
  isDevMode: boolean,
): FilteredCommands {
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

  const filteredNavigation = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if searching for navigation category (must be a close match)
    const navKeywords = ["navigation", "navigate", "go to", "jump to", "pages"];
    const isSearchingCategory = navKeywords.some(
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_CATEGORY_MATCH_LENGTH,
    );

    if (isSearchingCategory) {
      return availableNavCommands;
    }

    return filterCommands(availableNavCommands, query);
  }, [query, availableNavCommands]);

  const availableActionCommands = useMemo(() => {
    return hasOpsAccess
      ? actionCommands
      : actionCommands.filter((cmd) => cmd.id !== "action-send-trace");
  }, [hasOpsAccess]);

  const filteredActions = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if searching for actions category (must be a close match)
    const actionKeywords = ["new", "create", "add new", "actions"];
    const isSearchingCategory = actionKeywords.some(
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_SEARCH_QUERY_LENGTH,
    );

    if (isSearchingCategory) {
      return availableActionCommands;
    }

    return filterCommands(availableActionCommands, query);
  }, [query, availableActionCommands]);

  // Filter support commands based on query (filter out "Open Chat" if not SAAS)
  const filteredSupport = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if searching for support/help category
    const supportKeywords = ["support", "help", "docs", "documentation", "chat"];
    const isSearchingCategory = supportKeywords.some(
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_SEARCH_QUERY_LENGTH,
    );

    // Filter out "Open Chat" if not SAAS and set dynamic paths
    const availableCommands = supportCommands
      .filter((cmd) => isSaas || cmd.id !== "action-open-chat")
      .map((cmd) => {
        // Set dynamic path for plans command
        if (cmd.id === "support-plans") {
          return { ...cmd, path: planManagementHref(isSaas ?? false) };
        }
        return cmd;
      });

    if (isSearchingCategory) {
      return availableCommands;
    }

    return filterCommands(availableCommands, query);
  }, [query, isSaas]);

  // Filter theme commands based on query
  const filteredTheme = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if searching for theme category
    const themeKeywords = ["theme", "dark", "light", "mode", "appearance"];
    const isSearchingCategory = themeKeywords.some(
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_SEARCH_QUERY_LENGTH,
    );

    if (isSearchingCategory) {
      return themeCommands;
    }

    return filterCommands(themeCommands, query);
  }, [query]);

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
