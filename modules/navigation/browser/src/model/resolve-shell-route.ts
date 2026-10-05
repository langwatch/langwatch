import {
  isOrganizationScopedProduct,
  isPathUnder,
  isSettingsShellRoute,
  type ProductId,
  productById,
  productFromPathname,
  seatReachesProduct,
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
  /**
   * The product the address names when the viewer's seat does not reach it,
   * with the grant the standard permission alert names; null when the page opens.
   */
  seatRefusal: SeatRefusal | null;
}

export interface SeatRefusal {
  productId: ProductId;
  permission: string;
}

/**
 * The seat gate every page in the shell sits behind (ARCHITECTURE.md §10): a
 * page that belongs to no product is not seat-gated.
 */
function seatRefusalAt({
  pathname,
  organizationRole,
}: {
  pathname: string;
  organizationRole: string | null | undefined;
}): SeatRefusal | null {
  const productId = productFromPathname(pathname);
  if (!productId) return null;
  const product = productById(productId);
  if (seatReachesProduct({ product, organizationRole })) return null;
  const permission = product.gates.find((gate) => gate.permission)?.permission ?? product.label;
  return { productId, permission };
}

/** Product and scope resolver; settings detour is not a product; match on segment boundary */
export function resolveShellRoute({
  pathname,
  isPersonalScope,
  isOrgScope,
  isOnOwnPersonalProject,
  organizationRole,
}: {
  pathname: string;
  isPersonalScope: boolean;
  isOrgScope: boolean;
  isOnOwnPersonalProject: boolean;
  /** The viewer's seat; the seat gate refuses a product it does not reach. */
  organizationRole: string | null | undefined;
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
    seatRefusal: seatRefusalAt({ pathname, organizationRole }),
  };
}
