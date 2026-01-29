import { useMemo } from "react";
import type { Command } from "../types";
import {
  actionCommands,
  filterCommands,
  navigationCommands,
  supportCommands,
  themeCommands,
} from "../command-registry";
import { MIN_SEARCH_QUERY_LENGTH, MIN_CATEGORY_MATCH_LENGTH } from "../constants";

export interface FilteredCommands {
  navigation: Command[];
  actions: Command[];
  support: Command[];
  theme: Command[];
}

/**
 * Hook for filtering commands based on search query.
 * Handles category-based and keyword-based filtering.
 */
export function useFilteredCommands(
  query: string,
  isSaas: boolean | undefined
): FilteredCommands {
  const filteredNavigation = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if searching for navigation category (must be a close match)
    const navKeywords = ["navigation", "navigate", "go to", "jump to", "pages"];
    const isSearchingCategory = navKeywords.some(
      (kw) =>
        kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_CATEGORY_MATCH_LENGTH
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
      (kw) =>
        kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_SEARCH_QUERY_LENGTH
    );

    if (isSearchingCategory) {
      return actionCommands;
    }

    return filterCommands(actionCommands, query);
  }, [query]);

  // Filter support commands based on query (filter out "Open Chat" if not SAAS)
  const filteredSupport = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if searching for support/help category
    const supportKeywords = ["support", "help", "docs", "documentation", "chat"];
    const isSearchingCategory = supportKeywords.some(
      (kw) =>
        kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_SEARCH_QUERY_LENGTH
    );

    // Filter out "Open Chat" if not SAAS
    const availableCommands = isSaas
      ? supportCommands
      : supportCommands.filter((cmd) => cmd.id !== "action-open-chat");

    if (isSearchingCategory) {
      return availableCommands;
    }

    return filterCommands(availableCommands, query);
  }, [query, isSaas]);

  // Filter theme commands based on query
  const filteredTheme = useMemo(() => {
    if (!query.trim() || themeCommands.length === 0) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if searching for theme category
    const themeKeywords = ["theme", "dark", "light", "mode", "appearance"];
    const isSearchingCategory = themeKeywords.some(
      (kw) =>
        kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_SEARCH_QUERY_LENGTH
    );

    if (isSearchingCategory) {
      return themeCommands;
    }

    return filterCommands(themeCommands, query);
  }, [query]);

  return {
    navigation: filteredNavigation,
    actions: filteredActions,
    support: filteredSupport,
    theme: filteredTheme,
  };
}
