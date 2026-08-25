/**
 * Whether an organization's requirement is holding this person, and what the
 * screen has to say if it is.
 *
 * A pure function over the standing the server answered, for the reason the
 * join interstitial's decision is one: the gate is a whole page swapped in
 * place of somebody's work, and a rule that decides that has to be testable
 * without a browser.
 *
 * The default is ALWAYS "not held". Anything still loading, anything the
 * server could not answer, and anything about an organization that asks for
 * nothing all read as open — a gate that appears while a query is in flight
 * would flash in front of every member of every organization on every
 * navigation, and a gate that appears because a request failed would hold
 * people out for an outage they did nothing to cause.
 */

/** What the server says about one person and one organization. */
export interface OrganizationMfaStandingView {
  organizationId: string;
  organizationName: string;
  required: boolean;
  satisfaction: { satisfied: boolean };
  holdsPasskey: boolean;
}

export type EnrollmentGateOutcome =
  | { held: false }
  | {
      held: true;
      organizationName: string;
      /**
       * Whether to name signing in with their passkey as a second way
       * through. A passkey satisfies the requirement through the SIGN-IN that
       * used it, so somebody who holds one and signed in with a password is
       * one sign-in away rather than one setup away — and telling them to set
       * up something they effectively already have reads as a bug.
       */
      offerPasskey: boolean;
    };

export function resolveEnrollmentGate({
  standing,
  isPersonalScope = false,
}: {
  standing: OrganizationMfaStandingView | null | undefined;
  /**
   * Somebody's own workspace is never held. The requirement belongs to the
   * organization that set it, and nobody's personal workspace is stranded by
   * their employer's decision.
   */
  isPersonalScope?: boolean;
}): EnrollmentGateOutcome {
  if (isPersonalScope) return { held: false };
  if (!standing) return { held: false };
  if (!standing.required) return { held: false };
  if (standing.satisfaction.satisfied) return { held: false };
  return {
    held: true,
    organizationName: standing.organizationName,
    offerPasskey: standing.holdsPasskey,
  };
}
