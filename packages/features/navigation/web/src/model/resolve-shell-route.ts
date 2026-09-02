import {
  isPathUnder,
  isSettingsShellRoute,
  type ProductId,
  productFromPathname,
} from "./products";

export interface ShellRoute {
  /**
   * The settings detour, which covers the settings pages and the
   * internal ops pages. Both draw the settings chrome.
   */
  isSettingsRoute: boolean;
  isPersonalScopeRoute: boolean;
  isOrgScopeRoute: boolean;
  /** Null on the settings detour, which is not a product. */
  activeProductId: ProductId | null;
}

/**
 * Which product the address belongs to, and which scope its top bar
 * carries. The settings detour is not a product: no active product, a
 * static title in the top bar, and the settings sidebar surface. The
 * internal ops pages take that same detour, because the settings menu is
 * where the new modes offer them.
 *
 * Every top-level test matches on the segment boundary. A project slug is
 * a top-level address, and names like "metadata" or "settings-team" are
 * not reserved, so a plain prefix test would hand those projects the Me or
 * the Settings shell and skip the project the address asks for.
 *
 * Specs: specs/navigation/product-switcher-navigation.feature,
 *        specs/navigation/icon-rail-navigation.feature,
 *        specs/navigation/ops-navigation-v2.feature
 */
export function resolveShellRoute({
  pathname,
  isPersonalScope,
  isOrgScope,
  isOnOwnPersonalProject,
}: {
  pathname: string;
  isPersonalScope: boolean;
  isOrgScope: boolean;
  isOnOwnPersonalProject: boolean;
}): ShellRoute {
  const isSettingsRoute = isSettingsShellRoute(pathname);
  const isPersonalScopeRoute =
    !isSettingsRoute &&
    (isPersonalScope || isPathUnder({ pathname, base: "/me" }) || isOnOwnPersonalProject);
  const activeProductId = isSettingsRoute
    ? null
    : ((isPersonalScopeRoute ? "me" : productFromPathname(pathname)) ?? "llm-ops");
  const isOrgScopeRoute =
    isOrgScope ||
    isSettingsRoute ||
    activeProductId === "gateway" ||
    activeProductId === "governance";

  return {
    isSettingsRoute,
    isPersonalScopeRoute,
    isOrgScopeRoute,
    activeProductId,
  };
}
