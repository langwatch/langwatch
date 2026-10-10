import { type ProductId, productById } from "./products.ts";

/**
 * Where an in-place organization switch lands: the same product's home in
 * the new organization when reachable, else that org's project home, else
 * Me, else the root (which re-resolves).
 */
export function resolveOrgSwitchDestination({
  currentProduct,
  reachableProducts,
  projectSlug,
}: {
  currentProduct: ProductId | null;
  reachableProducts: readonly ProductId[];
  projectSlug: string | null;
}): string {
  if (currentProduct && reachableProducts.includes(currentProduct)) {
    const home = productById(currentProduct).homeHref({ projectSlug });
    if (home) return home;
  }
  if (projectSlug) return `/${projectSlug}`;
  if (reachableProducts.includes("me")) return "/me";
  return "/";
}
