import {
  isOrganizationScopedProduct,
  isPathUnder,
  isSettingsShellRoute,
  type ProductId,
  productFromPathname,
} from "./products.ts";

/**
 * The root address, which resolves where a reader belongs rather than
 * displaying anything. Named once: the chrome's data gate and the page body's
 * membership gate both have to agree, and neither may refuse a reader here.
 */
export function isResolverAddress(pathname: string): boolean {
  return pathname === "/";
}

export interface ShellRoute {
  /**
   * The settings detour, which covers the settings pages and the
   * internal ops pages. Both draw the settings chrome.
   */
  isSettingsRoute: boolean;
  isPersonalScopeRoute: boolean;
  isOrgScopeRoute: boolean;
  /**
   * The root resolver. It names no project, and the screen that chooses one
   * renders inside this chrome — so waiting for a project here waits on this
   * route's own output. specs/navigation/navigation-v2-landing.feature.
   */
  isResolverRoute: boolean;
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
    isResolverRoute: isResolverAddress(pathname),
    activeProductId,
  };
}
