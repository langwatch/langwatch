import type { SsoPublishedProofChannel } from "@langwatch/identity-contract";

/**
 * One domain to re-read, and the connection whose history carries the answer
 * (ADR-123). The hash makes a re-read verification rather than "is anything
 * at all published at our name"; the method is where the sweep looks.
 */
export interface SsoDomainReproofTarget {
  connectionId: string;
  organizationId: string;
  domain: string;
  tokenHash: string;
  method: SsoPublishedProofChannel;
}

/**
 * Which domains are due a re-read, and the record that the sweep LOOKED.
 * Cross-organization by nature — the sweep is the platform's, not a tenant's.
 */
export abstract class SsoDomainReproofTargetRepository {
  /** Every due domain, oldest look first, so the rotation is round-robin. */
  abstract findDomainsProvedByRecord(args: { limit: number }): Promise<SsoDomainReproofTarget[]>;

  /**
   * Stamp that the sweep looked, whatever it found. Ordering by what a
   * re-read writes cannot work: the healthy write nothing, and the one that
   * does is the domain that just began wavering, sorted out of the batch.
   */
  abstract markSwept(args: { connectionIds: readonly string[]; atMs: number }): Promise<void>;
}
