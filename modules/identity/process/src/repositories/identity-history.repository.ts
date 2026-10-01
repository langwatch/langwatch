import type { IdentityHistoryEntry, LinkProposalRecord } from "@langwatch/identity-contract";

/**
 * A person's identity log, read. Tenancy is the user (`tenantId === userId`),
 * so a read is one person's history by construction.
 */
export abstract class IdentityHistoryRepository {
  /** Newest first, at most `limit`. */
  abstract findHistory(args: {
    userId: string;
    limit: number;
  }): Promise<readonly IdentityHistoryEntry[]>;

  /** Every proposal the log holds for this person, newest first. */
  abstract findProposals(args: { userId: string }): Promise<readonly LinkProposalRecord[]>;
}
