import type {
  AttachIdentifierCommandData,
  DetachIdentifierCommandData,
  EraseUserCommandData,
  IdentityFact,
  ProposeLinkCommandData,
  VerifyIdentifierCommandData,
} from "@langwatch/identity-contract";

/**
 * The identity write surface, sliced by ROLE (ADR-115): three collaborators
 * need three different verb subsets, each a real boundary (e.g. the
 * better-auth adapter must never verify). A named interface documents that
 * reason; a `Pick<IdentityService, …>` would just silently follow the class.
 */

/** The verbs a better-auth ceremony can run (adapter.ts's whole reach). */
export interface IdentityCeremonyWrites {
  attachIdentifier(input: AttachIdentifierCommandData): Promise<IdentityFact[]>;
  detachIdentifier(input: DetachIdentifierCommandData): Promise<IdentityFact[]>;
  eraseUser(input: EraseUserCommandData): Promise<IdentityFact[]>;
}

/** The one verb the email verification ceremony completes with. */
export interface IdentityVerificationWrites {
  verifyIdentifier(input: VerifyIdentifierCommandData): Promise<IdentityFact[]>;
}

/**
 * The ONE verb an SSO callback's linking decision states (ADR-117 §3).
 * Auto-linking is deliberately absent: a link is made by creating the
 * provider account through better-auth, never by a hand-written insert.
 */
export interface IdentityLinkProposalWrites {
  proposeLink(input: ProposeLinkCommandData): Promise<IdentityFact[]>;
}

/** The verbs one backfill pass states: adopt, establish, compensate. */
export interface IdentityAdoptionWrites {
  attachIdentifier(input: AttachIdentifierCommandData): Promise<IdentityFact[]>;
  verifyIdentifier(input: VerifyIdentifierCommandData): Promise<IdentityFact[]>;
  detachIdentifier(input: DetachIdentifierCommandData): Promise<IdentityFact[]>;
}
