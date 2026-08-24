/**
 * Join before create: the seam D12 fills (ADR-117 §6).
 *
 * The contract in one line: a verified email address goes in, an interstitial
 * decision comes out. Sign-up asks this once, immediately after the address is
 * confirmed and before a workspace is created, and renders whatever it
 * answers. Today it always answers `create_workspace`, the interstitial
 * renders nothing, and sign-up carries on exactly as it would without it — so
 * D12 is additive: it fills in the matching and the words, and changes no
 * caller.
 */
export interface JoinBeforeCreateInput {
  /** The address the person just confirmed. Nothing else is known yet: no
   *  account exists at this point in sign-up. */
  verifiedEmail: string;
}

/** An organization the person could join instead of creating their own. */
export interface JoinableOrganization {
  id: string;
  name: string;
}

export type JoinBeforeCreateDecision =
  /** Nothing to offer: sign-up continues to workspace creation. */
  | { outcome: "create_workspace" }
  /** At least one organization will take them. Joining leads, creating stays
   *  available as the explicit second choice. */
  | { outcome: "offer_join"; organizations: readonly JoinableOrganization[] };

/**
 * D12 replaces this body with the domain match. It stays a function of the
 * verified address alone, because that is the only thing sign-up holds at
 * this point and the only thing the decision may depend on.
 */
export function resolveJoinBeforeCreate(
  _input: JoinBeforeCreateInput,
): JoinBeforeCreateDecision {
  return { outcome: "create_workspace" };
}
