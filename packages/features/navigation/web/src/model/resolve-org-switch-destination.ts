import { type ProductId, productById } from "./products";

/**
 * Where an in-place organization switch lands in the new navigation
 * modes: the same product's home in the new organization when it is
 * reachable there, else that organization's project home, else Me, else
 * the root (which re-resolves).
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
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
