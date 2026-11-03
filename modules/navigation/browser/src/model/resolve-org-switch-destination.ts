import { type ProductId, productById } from "./products.ts";

/**
 * Where an in-place organization switch lands: the settings detour stays put,
 * else the same product's home in the new organization when reachable, else
 * that org's project home, else Me, else the root (which re-resolves).
 */
export function resolveOrgSwitchDestination({
  currentProduct,
  reachableProducts,
  projectSlug,
  settingsPathname = null,
}: {
  currentProduct: ProductId | null;
  reachableProducts: readonly ProductId[];
  projectSlug: string | null;
  /**
   * The detour address the reader is on, null anywhere else and null when it
   * names an entity of the organization being left. A detour carries no
   * product, so without it the resolver throws the reader out of settings.
   */
  settingsPathname?: string | null;
}): string {
  if (settingsPathname) return settingsPathname;
  if (currentProduct && reachableProducts.includes(currentProduct)) {
    const home = productById(currentProduct).homeHref({ projectSlug });
    if (home) return home;
  }
  if (projectSlug) return `/${projectSlug}`;
  if (reachableProducts.includes("me")) return "/me";
  return "/";
}
