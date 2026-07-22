import { useBreakpointValue } from "@chakra-ui/react";
import { useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";

import { trackEvent } from "~/utils/tracking";

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "langwatch:sidebar:collapsed:v1";

/**
 * The user's global sidebar collapse preference. One choice for the whole
 * app — not per page, not per project — persisted in localStorage and
 * broadcast across components in-tab by usehooks-ts.
 *
 * Resolution order:
 *   1. Small screens are always collapsed (the rail still expands on hover).
 *   2. An explicit user choice wins everywhere once made.
 *   3. Until the user chooses, pages keep their own default density
 *      (`pageDefaultsToCompact`, e.g. Settings and the prompt playground).
 *
 * Spec: specs/navigation/sidebar-collapse-preference.feature
 */
export function useSidebarCollapsed({
  pageDefaultsToCompact = false,
}: { pageDefaultsToCompact?: boolean } = {}) {
  // fallback: "lg" assumes a desktop screen during SSR so the sidebar
  // hydrates expanded and only compacts after mount on small screens —
  // the same trick DashboardLayout has always used to avoid the
  // compact→expanded flicker on desktop navigations.
  const isSmallScreen = useBreakpointValue(
    { base: true, lg: false },
    { fallback: "lg" },
  );
  // initializeWithValue: false keeps the first client render identical to the
  // server render (no stored value applied yet), so hydration never mismatches;
  // the stored preference snaps in right after mount.
  const [preference, setPreference] = useLocalStorage<boolean | null>(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    null,
    { initializeWithValue: false },
  );

  const isCollapsed = isSmallScreen ? true : (preference ?? pageDefaultsToCompact);
  const canToggle = !isSmallScreen;

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      setPreference(collapsed);
      trackEvent("sidebar_collapse_toggle", { collapsed });
    },
    [setPreference],
  );

  return { isCollapsed, canToggle, setCollapsed };
}
