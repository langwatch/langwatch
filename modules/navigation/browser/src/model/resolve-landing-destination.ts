import { CODING_AGENTS_PATH } from "@langwatch/user-contract";

import { type ProductId, productById, productHomeHref } from "./products.ts";

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
  /** Dashboards then lands on the organization's library, as the rail opens it. */
  hasOrganizationLibrary?: boolean;
}

/** Landing destination ("/") in order: pin, remembered product, server resolver, safety nets */
export function resolveLandingDestination({
  pinnedPath,
  rememberedProduct,
  reachableProducts,
  serverHomeDestination,
  projectSlug,
  hasOrganizationLibrary = false,
}: LandingDestinationInput): string | null {
  if (pinnedPath) return pinnedPath;

  if (rememberedProduct && reachableProducts.includes(rememberedProduct)) {
    const product = productById(rememberedProduct);
    const home = productHomeHref({ product, projectSlug, hasOrganizationLibrary });
    if (home) return home;
  }

  if (serverHomeDestination) return serverHomeDestination;

  if (projectSlug) return `/${projectSlug}`;
  if (reachableProducts.includes("me")) return CODING_AGENTS_PATH;
  return null;
}
