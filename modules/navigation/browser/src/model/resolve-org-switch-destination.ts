import { CODING_AGENTS_PATH } from "@langwatch/user-contract";

import { type ProductId, productById, productHomeHref } from "./products.ts";

/**
 * Where an in-place organization switch lands: the settings detour stays put,
 * else the same product's home in the new organization when reachable, else
 * that org's project home, else Coding agents, else the root (which re-resolves).
 */
export function resolveOrgSwitchDestination({
  currentProduct,
  reachableProducts,
  projectSlug,
  hasOrganizationLibrary = false,
  settingsPathname = null,
}: {
  currentProduct: ProductId | null;
  reachableProducts: readonly ProductId[];
  projectSlug: string | null;
  /** Whether the new organization has the Dashboards area, so Dashboards lands on its library. */
  hasOrganizationLibrary?: boolean;
  /**
   * The detour address the reader is on, null anywhere else and null when it
   * names an entity of the organization being left. A detour carries no
   * product, so without it the resolver throws the reader out of settings.
   */
  settingsPathname?: string | null;
}): string {
  if (settingsPathname) return settingsPathname;
  if (currentProduct && reachableProducts.includes(currentProduct)) {
    const product = productById(currentProduct);
    const home = productHomeHref({ product, projectSlug, hasOrganizationLibrary });
    if (home) return home;
  }
  if (projectSlug) return `/${projectSlug}`;
  if (reachableProducts.includes("me")) return CODING_AGENTS_PATH;
  return "/";
}
