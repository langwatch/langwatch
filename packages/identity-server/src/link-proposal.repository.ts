import type { IdentifierProvider, LinkProposalReason } from "@langwatch/identity";

/**
 * A proposal, and what has become of it (ADR-117 §3).
 *
 * There is no proposal ROW anywhere: a proposal is a fact, and so is its
 * decision. This is the read model an implementation folds out of the two,
 * which is why `decision` is nullable rather than a state column — an
 * undecided proposal is one whose decision fact has not been stated.
 */
export interface LinkProposalRecord {
  proposalId: string;
  userId: string;
  connectionId: string | null;
  provider: IdentifierProvider;
  /** The identity provider's own subject. Opaque, never a secret. */
  providerAccountId: string;
  /** The normalized asserted address; null once erasure has wiped it. */
  value: string | null;
  domain: string | null;
  reason: LinkProposalReason;
  proposedAtMs: number;
  decision: LinkProposalDecision | null;
}

export interface LinkProposalDecision {
  outcome: "confirmed" | "rejected";
  /** The actor id on the deciding fact; null for a system decision. */
  byActorId: string | null;
  atMs: number;
}

/**
 * The reads a decision needs. Deliberately narrow: one proposal by id, and
 * everything still waiting for one person. A guard that could list across
 * users would be a cross-tenant read living inside a per-user aggregate.
 */
export interface LinkProposalReadsRepository {
  findProposal(input: {
    userId: string;
    proposalId: string;
  }): Promise<LinkProposalRecord | null>;

  findProposals(input: {
    userId: string;
  }): Promise<readonly LinkProposalRecord[]>;
}
