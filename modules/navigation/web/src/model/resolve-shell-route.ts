<<<<<<< HEAD:modules/navigation/web/src/model/resolve-shell-route.ts
import { isPathUnder, isSettingsShellRoute, type ProductId, productFromPathname } from "./products.ts";
=======
import {
  isOrganizationScopedProduct,
  isPathUnder,
  isSettingsShellRoute,
  type ProductId,
  productFromPathname,
} from "../products";
>>>>>>> origin/main:platform/app/src/features/navigation/logic/resolveShellRoute.ts

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
  // The product the ADDRESS names, before any sticky scope is applied.
  const addressedProductId = productFromPathname(pathname);
  /**
   * Products the registry marks organization-wide (Gateway, Governance) are
   * read across the whole organization, so a personal scope can never be the
   * one they are read in.
   *
   * This matters because `isOnOwnPersonalProject` is a fact about the sticky
   * ambient team, not about the address: a reader whose last project was their
   * own workspace carries it into every later page. Without this exclusion
   * they arrived at /gateway and got the Me shell — the Personal badge in the
   * top bar, the personal sidebar, and "Me" lit in the product switcher while
   * the address said Gateway. Settings was already excluded for exactly this
   * reason and on exactly this line.
   */
  const isOrgScopedProduct = isOrganizationScopedProduct(addressedProductId);
  const isPersonalScopeRoute =
    !isSettingsRoute &&
<<<<<<< HEAD:modules/navigation/web/src/model/resolve-shell-route.ts
    (isPersonalScope || isPathUnder({ pathname, base: "/me" }) || isOnOwnPersonalProject);
  const activeProductId = isSettingsRoute
    ? null
    : ((isPersonalScopeRoute ? "me" : productFromPathname(pathname)) ?? "llm-ops");
=======
    !isOrgScopedProduct &&
    (isPersonalScope ||
      isPathUnder({ pathname, base: "/me" }) ||
      isOnOwnPersonalProject);
  const activeProductId = isSettingsRoute
    ? null
    : ((isPersonalScopeRoute ? "me" : addressedProductId) ?? "llm-ops");
>>>>>>> origin/main:platform/app/src/features/navigation/logic/resolveShellRoute.ts
  const isOrgScopeRoute =
    isOrgScope ||
    isSettingsRoute ||
    isOrganizationScopedProduct(activeProductId);

  return {
    isSettingsRoute,
    isPersonalScopeRoute,
    isOrgScopeRoute,
    activeProductId,
  };
}
