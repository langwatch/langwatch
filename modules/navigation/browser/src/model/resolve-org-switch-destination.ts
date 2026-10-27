import { type ProductId, productById } from "./products.ts";

/**
 * Where an in-place organization switch lands: the settings detour stays
 * where it is, else the same product's home in the new organization when
 * reachable, else that org's project home, else Me, else the root (which
 * re-resolves).
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
   * The settings or ops address the reader is on, null anywhere else. The
   * detour is not a product, so `currentProduct` is null there and the
   * resolver would otherwise throw the reader out of settings; every page
   * on it exists in every organization, so it stays put.
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
