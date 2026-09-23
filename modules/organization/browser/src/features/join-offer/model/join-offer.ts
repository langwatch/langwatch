/**
 * What the post-login offer shows, decided from the two answers the server
 * gives: the offer itself and the requests this person is already waiting on.
 */
import type { JoinLookupDecision, JoinOffer } from "@langwatch/identity-contract";

export type JoinOfferView =
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
  waitingOn,
  currentOrganizationId,
}: {
  decision: JoinLookupDecision | undefined;
  waitingOn: readonly { organizationId: string }[];
  currentOrganizationId: string | null;
}): JoinOfferView {
  const waiting = waitingOn.find(
    (request) => currentOrganizationId === null || request.organizationId === currentOrganizationId,
  );
  if (waiting) {
    return {
      kind: "waiting",
      organizationName: organizationNameFor({ decision, organizationId: waiting.organizationId }),
    };
  }

  if (decision?.outcome !== "ask" || decision.organizations.length === 0) {
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
  if (decision?.outcome !== "ask") return null;
  return (
    decision.organizations.find((offer) => offer.organizationId === organizationId)?.name ?? null
  );
}
