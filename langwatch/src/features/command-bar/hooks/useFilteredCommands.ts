import { ToggleLeft } from "lucide-react";
import { useMemo } from "react";
import { useRouter } from "~/utils/compat/next-router";
import type { Command } from "../types";
import {
  actionCommands,
  filterCommands,
  navigationCommands,
  supportCommands,
  themeCommands,
} from "../command-registry";
import { MIN_SEARCH_QUERY_LENGTH, MIN_CATEGORY_MATCH_LENGTH } from "../constants";
import { getPlanManagementUrl } from "~/hooks/usePlanManagementUrl";
import { getPageCommands } from "../pageCommands";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import {
  setFeatureFlagOverride,
  useFeatureFlagOverrides,
} from "~/hooks/useFeatureFlagOverrides";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { FRONTEND_FEATURE_FLAGS } from "~/server/featureFlag/frontendFeatureFlags";

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
  const { enabled: isDarkModeEnabled } = useFeatureFlag(
    "release_ui_dark_mode_enabled",
  );
  const { enabled: isTracesV2Enabled } = useFeatureFlag(
    "release_ui_traces_v2_enabled",
    { projectId, enabled: !!projectId },
  );
  const { hasAccess: hasOpsAccess } = useOpsPermission();

  const availableNavCommands = useMemo(() => {
    let commands = hasOpsAccess
      ? navigationCommands
      : navigationCommands.filter((cmd) => !cmd.id.startsWith("nav-ops"));
    if (!isTracesV2Enabled) {
      commands = commands.filter((cmd) => cmd.id !== "nav-traces-v2");
    }
    return commands;
  }, [hasOpsAccess, isTracesV2Enabled]);

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
      return availableNavCommands;
    }

    return filterCommands(availableNavCommands, query);
  }, [query, availableNavCommands]);

  const featureFlagOverrides = useFeatureFlagOverrides();
  const featureFlagToggleCommands = useMemo<Command[]>(() => {
    if (!isDevMode) return [];
    return FRONTEND_FEATURE_FLAGS.map((flag) => {
      const current = featureFlagOverrides[flag];
      const stateLabel =
        current === undefined
          ? "server-resolved"
          : current
            ? "forced ON"
            : "forced OFF";
      return {
        id: `action-feature-flag-toggle:${flag}`,
        label: `Toggle ${flag}`,
        description: `Currently ${stateLabel} — cycles default → on → off`,
        icon: ToggleLeft,
        category: "actions",
        keywords: [
          "feature",
          "flag",
          "flags",
          "toggle",
          "dev",
          "override",
          flag,
        ],
        action: () => {
          const next =
            current === undefined ? true : current === true ? false : undefined;
          setFeatureFlagOverride(flag, next);
        },
      };
    });
  }, [isDevMode, featureFlagOverrides]);

  const availableActionCommands = useMemo(() => {
    let commands = hasOpsAccess
      ? actionCommands
      : actionCommands.filter((cmd) => cmd.id !== "action-send-trace");
    if (!isDevMode) {
      commands = commands.filter((cmd) => cmd.id !== "action-feature-flags");
    }
    return [...commands, ...featureFlagToggleCommands];
  }, [hasOpsAccess, isDevMode, featureFlagToggleCommands]);

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
      (kw) =>
        kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_SEARCH_QUERY_LENGTH
    );

    // Filter out "Open Chat" if not SAAS and set dynamic paths
    const availableCommands = supportCommands
      .filter((cmd) => isSaas || cmd.id !== "action-open-chat")
      .map((cmd) => {
        // Set dynamic path for plans command
        if (cmd.id === "support-plans") {
          return { ...cmd, path: getPlanManagementUrl(isSaas ?? false) };
        }
        return cmd;
      });

    if (isSearchingCategory) {
      return availableCommands;
    }

    return filterCommands(availableCommands, query);
  }, [query, isSaas]);

  // Filter theme commands based on query (only when dark mode flag is enabled)
  const filteredTheme = useMemo(() => {
    if (!isDarkModeEnabled || !query.trim()) return [];

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
  }, [query, isDarkModeEnabled]);

  // Filter page-specific commands based on current route
  const router = useRouter();
  const filteredPage = useMemo(() => {
    if (!query.trim()) return [];
    const pageCommands = getPageCommands(router.pathname);
    return filterCommands(pageCommands, query);
  }, [query, router.pathname]);

  return {
    navigation: filteredNavigation,
    actions: filteredActions,
    support: filteredSupport,
    theme: filteredTheme,
    page: filteredPage,
  };
}
