import type {
  AttachIdentifierCommandData,
  DetachIdentifierCommandData,
  EraseUserCommandData,
  IdentityFact,
  ProposeLinkCommandData,
  VerifyIdentifierCommandData,
} from "@langwatch/identity-contract";

/**
 * The identity write surface, sliced by ROLE (ADR-115).
 *
 * Three collaborators need three different subsets of the five verbs, and
 * each subset is a real boundary: the better-auth adapter must never verify
 * an identifier, the verification ceremony must never attach one, and the
 * backfill must never erase a user. A `Pick<IdentityService, …>` expresses
 * the same subset, but it is a slice of a CLASS rather than a contract — it
 * names no role, documents no reason, and silently follows the class
 * wherever it goes. authz declares `AuthzEngineLedger` and
 * `AuthzGrantsRepository` as named interfaces for exactly this reason; so
 * do these.
 *
 * `IdentityService` implements all three, and says so, so the compiler
 * fails the day a verb drifts away from the role that depends on it.
 */

/** The verbs a better-auth ceremony can run (adapter.ts's whole reach). */
export interface IdentityCeremonyWrites {
  attachIdentifier(
    input: AttachIdentifierCommandData,
  ): Promise<IdentityFact[]>;
  detachIdentifier(
    input: DetachIdentifierCommandData,
  ): Promise<IdentityFact[]>;
  eraseUser(input: EraseUserCommandData): Promise<IdentityFact[]>;
}

/** The one verb the email verification ceremony completes with. */
export interface IdentityVerificationWrites {
  verifyIdentifier(
    input: VerifyIdentifierCommandData,
  ): Promise<IdentityFact[]>;
}

/**
 * The ONE verb an SSO callback's linking decision states on its own (ADR-117
 * §3): the proposal it records when the evidence is not two-sided.
 *
 * Auto-linking is deliberately absent. A link is made by creating the provider
 * account through better-auth, which fires the account ceremony that attaches
 * the identifier — "never a hand-written Account insert", and by the same
 * token never a hand-written identifier either. A callback that could attach
 * directly would be a second way to claim a row, which is the whole risk this
 * flow is guarding.
 */
export interface IdentityLinkProposalWrites {
  proposeLink(input: ProposeLinkCommandData): Promise<IdentityFact[]>;
}

/** The verbs one backfill pass states: adopt, establish, compensate. */
export interface IdentityAdoptionWrites {
  attachIdentifier(
    input: AttachIdentifierCommandData,
  ): Promise<IdentityFact[]>;
  verifyIdentifier(
    input: VerifyIdentifierCommandData,
  ): Promise<IdentityFact[]>;
  detachIdentifier(
    input: DetachIdentifierCommandData,
  ): Promise<IdentityFact[]>;
}
