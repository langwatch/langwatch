/**
 * Whether an organization's second-factor requirement holds this person (D06).
 * Anything unanswered reads as open, so the gate never flashes during a read
 * nor holds anyone out for an outage. Spec: specs/identity/mfa-and-session-shape.feature
 */
import type { OrganizationMfaStanding } from "@langwatch/identity-contract";

export type EnrollmentGate =
  | { held: false }
  | { held: true; organizationName: string; offerPasskey: boolean };

export function enrollmentGateOf({
  standing,
  isPersonalScope,
}: {
  standing: OrganizationMfaStanding | undefined;
  /** Somebody's own workspace is never held by their employer's requirement. */
  isPersonalScope: boolean;
}): EnrollmentGate {
  if (isPersonalScope || !standing) return { held: false };
  if (!standing.required || standing.satisfaction.satisfied) return { held: false };
  // No name means the server did not answer as to a member.
  if (standing.organizationName === null) return { held: false };
  return {
    held: true,
    organizationName: standing.organizationName,
    offerPasskey: standing.holdsPasskey,
  };
}
