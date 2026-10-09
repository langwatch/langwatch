/**
 * The quiet way back to the team on the organization form, for somebody who
 * already turned the offer down. Spec: specs/identity/join-before-create.feature
 */
import type { JoinLookupDecision, JoinOffer } from "@langwatch/identity-contract";

/** An organization the form can offer, and whether it lets the person straight in. */
export type JoinInsteadOrganization = Readonly<{
  organizationId: string;
  name: string;
  admits: "ask" | "auto";
}>;

export type JoinInsteadView =
  | Readonly<{ kind: "hidden" }>
  | Readonly<{ kind: "one"; organization: JoinInsteadOrganization }>
  | Readonly<{ kind: "several"; organizations: readonly JoinInsteadOrganization[] }>;

/**
 * Shown only where the takeover is not: the offer is closed (declined, or never
 * open), nothing is waiting and no invitation stands. `lookup` ignores declines.
 */
export function joinInsteadView({
  lookup,
  offer,
  waitingOn,
  invitationStands,
}: {
  lookup: JoinLookupDecision | undefined;
  offer: JoinLookupDecision | undefined;
  waitingOn: readonly unknown[];
  invitationStands: boolean;
}): JoinInsteadView {
  if (offer?.outcome !== "none" || waitingOn.length > 0 || invitationStands) {
    return { kind: "hidden" };
  }
  const organizations = joinable({ lookup });
  const [first] = organizations;
  if (first === undefined) return { kind: "hidden" };
  if (organizations.length === 1) return { kind: "one", organization: first };
  return { kind: "several", organizations };
}

function joinable({
  lookup,
}: {
  lookup: JoinLookupDecision | undefined;
}): JoinInsteadOrganization[] {
  if (lookup?.outcome === "auto")
    return [organizationOf({ offer: lookup.organization, admits: "auto" })];
  if (lookup?.outcome !== "ask") return [];
  return lookup.organizations.map((offer) => organizationOf({ offer, admits: "ask" }));
}

function organizationOf({
  offer,
  admits,
}: {
  offer: JoinOffer;
  admits: "ask" | "auto";
}): JoinInsteadOrganization {
  return { organizationId: offer.organizationId, name: offer.name, admits };
}
