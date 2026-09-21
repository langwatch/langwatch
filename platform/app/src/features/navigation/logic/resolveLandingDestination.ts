import { type ProductId, productById } from "../products";

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

/**
 * Where "/" goes in the new navigation modes, in strict order: the pin,
 * the remembered product (only when still reachable and resolvable), the
 * server resolver, then the safety nets. Null means nothing could be
 * decided and the caller keeps its existing bootstrap behavior
 * (onboarding for org-less users).
 *
 * Deliberate deviation from ADR-038 (recorded in the navigation ADR):
 * after the first product visit, product memory outranks the
 * organization intent. Legacy mode keeps ADR-038 unchanged.
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 */
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
