import { useRouter } from "~/utils/compat/next-router";
import { isSettingsShellRoute, productFromPathname } from "./products";
import { useNavigationMode } from "./useNavigationMode";

/**
 * Which routes the navigation-v2 shells cover: the product routes, the
 * settings pages, and the internal ops pages. The ops pages are offered
 * from the settings menu in the new modes, so they render in the same
 * shell rather than dropping the reader back into the legacy chrome.
 *
 * Spec: specs/navigation/ops-navigation-v2.feature
 */
export function isNavigationV2ShellRoute(pathname: string): boolean {
  return (
    productFromPathname(pathname) !== null || isSettingsShellRoute(pathname)
  );
}

/**
 * Whether the current page renders inside a navigation-v2 shell: the
 * device resolved to a new mode AND the route is one the shells cover.
 * Inner layouts use this to stand their duplicate navigation down; it
 * stays false while the mode is still resolving, so a legacy render
 * never loses its rail to a flash.
 */
export function useNavigationV2ShellActive(): boolean {
  const resolution = useNavigationMode();
  const router = useRouter();
  return (
    resolution.status === "ready" &&
    resolution.mode !== "legacy" &&
    isNavigationV2ShellRoute(router.pathname)
  );
}
