import {
  isPublicEmailDomain,
  type JoinLookupDecision,
  joinDomainOf,
} from "@langwatch/identity";

/**
 * Join before create: the seam D13 left and D12 fills (ADR-117 §6).
 *
 * The contract in one line: a verified email address goes in, an interstitial
 * decision comes out. Sign-up asks this once, immediately after the address is
 * confirmed and before a workspace is created, and renders whatever it
 * answers.
 *
 * The invariant that gives this deliverable its second name lives here rather
 * than in the screen: NO organization is created for anybody who did not
 * choose to create one. Every outcome below either offers a choice or says
 * nothing at all; none of them creates anything.
 *
 *   verify address ──► what is open to it?
 *                        ├─ nothing ─────► create_workspace   (as today)
 *                        ├─ automatic ───► already_joined     (no step at all)
 *                        ├─ ask ─────────► offer_join         (join leads)
 *                        └─ already asked► awaiting_approval  (creating anyway
 *                                                              stays explicit)
 */

export interface JoinBeforeCreateInput {
  /** The address the person just confirmed. Nothing else is known yet: no
   *  account exists at this point in sign-up. */
  verifiedEmail: string;
  /**
   * Whether that address has actually been PROVED.
   *
   * The gate, not a hint. An unverified address answers `create_workspace`
   * without consulting the lookup at all, which is what makes "nothing is
   * looked up and nothing is offered" true of the decision as well as of the
   * screen that calls it.
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
  /**
   * The server has not answered yet, so there is no decision to act on.
   *
   * Distinct from `create_workspace` on purpose, and the distinction is the
   * whole of a bug this used to have: "we have not asked yet" and "we asked
   * and there is nothing" both used to answer `create_workspace`, and the
   * caller's reaction to `create_workspace` is to NAVIGATE AWAY. So a person
   * who clicked "Ask to join" was redirected off the join page before the
   * lookup they came to read had returned, every time — the click looked like
   * it did nothing. Rendering nothing while in flight is right; leaving is
   * not, and the outcome has to say which one it means.
   */
  | { outcome: "pending" }
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

/**
 * The interstitial's decision.
 *
 * `verifiedEmail` is load-bearing rather than decorative: this re-checks the
 * address is email-shaped and NOT a consumer mail provider before it will
 * render any organization at all. The server enforces the same rule, so this
 * is a second, independent place the worst leak this deliverable can produce
 * has to get past — a bug on one side cannot offer strangers to each other on
 * its own.
 */
export function resolveJoinBeforeCreate({
  verifiedEmail,
  verified,
  lookup,
  pendingOrganizationId,
}: JoinBeforeCreateInput): JoinBeforeCreateDecision {
  if (!verified) return { outcome: "create_workspace" };
  // NOT `create_workspace`: an absent answer is a question still in flight,
  // and the caller reacts to `create_workspace` by leaving the page.
  if (!lookup) return { outcome: "pending" };

  const domain = joinDomainOf(verifiedEmail);
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
