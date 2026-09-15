import { type ProductId, productById } from "./products.ts";

export interface LandingDestinationInput {
  /**
   * The user's explicit home pin (the picker's lastHomePath), already
   * resolved server-side: resolveHome returns it with isOverride true.
   */
  pinnedPath: string | null;
  /** This device's last product for the organization, if any. */
  rememberedProduct: ProductId | null;
  /** Products the current user can open right now (gates evaluated). */
  reachableProducts: readonly ProductId[];
  /**
   * The server home resolver's answer (ADR-038: organization intent,
   * then persona default). Stays the cold-start default.
   */
  serverHomeDestination: string | null;
  /** Last non-personal project slug known on this device, if any. */
  projectSlug: string | null;
}

/** Landing destination ("/") in order: pin, remembered product, server resolver, safety nets */
export function resolveLandingDestination({
  pinnedPath,
  rememberedProduct,
  reachableProducts,
  serverHomeDestination,
  projectSlug,
}: LandingDestinationInput): string | null {
  if (pinnedPath) return pinnedPath;

  if (rememberedProduct && reachableProducts.includes(rememberedProduct)) {
    const home = productById(rememberedProduct).homeHref({ projectSlug });
    if (home) return home;
  }

  if (serverHomeDestination) return serverHomeDestination;

  if (projectSlug) return `/${projectSlug}`;
  if (reachableProducts.includes("me")) return "/me";
  return null;
}
