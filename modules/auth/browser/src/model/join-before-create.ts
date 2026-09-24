import {
  isPublicEmailDomain,
  type JoinLookupDecision,
  extractJoinDomain,
} from "@langwatch/identity-contract";

/** Join-before-create interstitial: determines whether to offer workspace join. */

export interface JoinBeforeCreateInput {
  /** The address the person just confirmed. Nothing else is known yet: no
   *  account exists at this point in sign-up. */
  verifiedEmail: string;
  /**
   * Whether that address has actually been PROVED — the gate, not a hint.
   * An unverified address answers `create_workspace` without consulting the
   * lookup at all, so nothing is looked up and nothing offered.
   */
  verified: boolean;
  /**
   * What the server answered for THIS address, when it has answered. Absent
   * while the answer is in flight, when the flag is off, and whenever the
   * caller has not asked — all of which render nothing.
   */
  lookup?: JoinLookupDecision;
  /** Whether this person already has a request waiting on one of these
   *  organizations, so the screen says so rather than offering the ask twice. */
  pendingOrganizationId?: string | null;
}

/** An organization the person could join instead of creating their own. */
export interface JoinableOrganization {
  id: string;
  name: string;
  /** Rounded, never the exact number — see `coarseColleagueCount`. */
  colleagueCount: number;
}

export type JoinBeforeCreateDecision =
  /** Nothing to offer: sign-up continues to workspace creation. */
  | { outcome: "create_workspace" }
  /** At least one organization will take them. Joining leads, creating stays
   *  available as the explicit second choice. */
  | { outcome: "offer_join"; organizations: readonly JoinableOrganization[] }
  /** The domain admits them automatically: they are a member already and the
   *  step is skipped entirely — no offer, and no workspace creation step. */
  | { outcome: "already_joined"; organization: JoinableOrganization }
  /** They have already asked. The screen says who it is waiting on, and
   *  creating an organization anyway stays a plain, explicit choice. */
  | { outcome: "awaiting_approval"; organization: JoinableOrganization };

/** Resolves join offer after address verification; re-checks domain independently. */
export function resolveJoinBeforeCreate({
  verifiedEmail,
  verified,
  lookup,
  pendingOrganizationId,
}: JoinBeforeCreateInput): JoinBeforeCreateDecision {
  if (!verified) return { outcome: "create_workspace" };
  if (!lookup) return { outcome: "create_workspace" };

  const domain = extractJoinDomain(verifiedEmail);
  if (!domain || isPublicEmailDomain(domain)) {
    return { outcome: "create_workspace" };
  }

  if (lookup.outcome === "none") return { outcome: "create_workspace" };

  if (lookup.outcome === "auto") {
    return {
      outcome: "already_joined",
      organization: joinableOf(lookup.organization),
    };
  }

  const waiting = pendingOrganizationId
    ? lookup.organizations.find(
        (organization) => organization.organizationId === pendingOrganizationId,
      )
    : undefined;
  if (waiting) {
    return { outcome: "awaiting_approval", organization: joinableOf(waiting) };
  }

  if (lookup.organizations.length === 0) {
    return { outcome: "create_workspace" };
  }
  return {
    outcome: "offer_join",
    organizations: lookup.organizations.map(joinableOf),
  };
}

function joinableOf(offer: {
  organizationId: string;
  name: string;
  colleagueCount: number;
}): JoinableOrganization {
  return {
    id: offer.organizationId,
    name: offer.name,
    colleagueCount: offer.colleagueCount,
  };
}
