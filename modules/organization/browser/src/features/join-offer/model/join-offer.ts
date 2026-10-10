/**
 * What the post-login offer shows, decided from the two answers the server
 * gives: the offer itself and the requests this person is already waiting on.
 */
import type { JoinLookupDecision, JoinOffer } from "@langwatch/identity-contract";

/** An invitation already waiting on one of the person's proven addresses (ADR-171 v6). */
export type JoinOfferInvitation = Readonly<{
  inviteCode: string;
  organizationName: string;
  inviterName: string | null;
  role: string;
}>;

export type JoinOfferView =
  | Readonly<{ kind: "invitation"; invitation: JoinOfferInvitation }>
  | Readonly<{ kind: "admitting"; organizationName: string }>
  | Readonly<{ kind: "waiting"; organizationName: string | null }>
  | Readonly<{ kind: "offer"; organizations: readonly JoinOffer[] }>
  | Readonly<{ kind: "nothing" }>;

/**
 * A pending request wins over any offer. A dashboard scopes the request to the
 * organization it shows; onboarding passes none, so any request blocks
 * creating a second organization.
 */
export function joinOfferView({
  decision,
  lookup,
  waitingOn,
  currentOrganizationId,
  invitation = null,
  askHeldDown = false,
  admitting = false,
}: {
  decision: JoinLookupDecision | undefined;
  /** Sign-up's lookup, which a decline does not close: it still names what is waited on. */
  lookup?: JoinLookupDecision;
  waitingOn: readonly { organizationId: string }[];
  currentOrganizationId: string | null;
  /** Only the welcome screen is handed one; it leads even over an open request. */
  invitation?: JoinOfferInvitation | null;
  /** An invitation may stand behind the ask: set aside this visit, or a failed read. */
  askHeldDown?: boolean;
  /** The welcome screen is walking through an automatic door right now. */
  admitting?: boolean;
}): JoinOfferView {
  // Accepting withdraws an open request, while waiting on it would land the joiner seat.
  if (invitation) return { kind: "invitation", invitation };

  const waiting = waitingOn.find(
    (request) => currentOrganizationId === null || request.organizationId === currentOrganizationId,
  );
  if (waiting) {
    return {
      kind: "waiting",
      organizationName:
        organizationNameFor({ decision, organizationId: waiting.organizationId }) ??
        organizationNameFor({ decision: lookup, organizationId: waiting.organizationId }),
    };
  }

  // An automatic match is not an offer to weigh: the arrival admits them.
  if (decision?.outcome === "auto") {
    return admitting
      ? { kind: "admitting", organizationName: decision.organization.name }
      : { kind: "nothing" };
  }

  if (decision?.outcome !== "ask" || decision.organizations.length === 0 || askHeldDown) {
    return { kind: "nothing" };
  }

  if (
    currentOrganizationId !== null &&
    !decision.organizations.some((offer) => offer.organizationId === currentOrganizationId)
  ) {
    return { kind: "nothing" };
  }

  return { kind: "offer", organizations: decision.organizations };
}

/** The name, when the offer still carries it; no name reads better than a wrong one. */
function organizationNameFor({
  decision,
  organizationId,
}: {
  decision: JoinLookupDecision | undefined;
  organizationId: string;
}): string | null {
  if (decision?.outcome === "auto") {
    return decision.organization.organizationId === organizationId
      ? decision.organization.name
      : null;
  }
  if (decision?.outcome !== "ask") return null;
  return (
    decision.organizations.find((offer) => offer.organizationId === organizationId)?.name ?? null
  );
}
