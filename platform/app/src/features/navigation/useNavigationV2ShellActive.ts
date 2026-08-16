import { useRouter } from "~/utils/compat/next-router";
import { productFromPathname } from "./products";
import { useNavigationMode } from "./useNavigationMode";

/**
 * Which routes the navigation-v2 shells cover: the product routes and
 * the settings pages. Internal ops pages keep the legacy chrome.
 */
export function isNavigationV2ShellRoute(pathname: string): boolean {
  return (
    productFromPathname(pathname) !== null ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/")
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
