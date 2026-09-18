import {
  isOrganizationScopedProduct,
  isPathUnder,
  isSettingsShellRoute,
  type ProductId,
  productFromPathname,
} from "./products.ts";

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

/** Product and scope resolver; settings detour is not a product; match on segment boundary */
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
  // The product the ADDRESS names, before any sticky scope is applied.
  const addressedProductId = productFromPathname(pathname);
  /** Org-scoped products: exclude personal scope to avoid wrong shell at /gateway */
  const isOrgScopedProduct = isOrganizationScopedProduct(addressedProductId);
  const isPersonalScopeRoute =
    !isSettingsRoute &&
    !isOrgScopedProduct &&
    (isPersonalScope || isPathUnder({ pathname, base: "/me" }) || isOnOwnPersonalProject);
  const activeProductId = isSettingsRoute
    ? null
    : ((isPersonalScopeRoute ? "me" : addressedProductId) ?? "llm-ops");
  const isOrgScopeRoute =
    isOrgScope || isSettingsRoute || isOrganizationScopedProduct(activeProductId);

  return {
    isSettingsRoute,
    isPersonalScopeRoute,
    isOrgScopeRoute,
    activeProductId,
  };
}
