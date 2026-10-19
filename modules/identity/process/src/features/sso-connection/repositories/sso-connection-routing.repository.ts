import type { SsoConnectionState } from "@langwatch/identity-contract";

/**
 * The connections sign-in routing reads, over the connection PROJECTION rather
 * than the legacy strings (ADR-117 §5): a SUSPENDED connection, not an absent one.
 * Which method each is dialed through is the routing service's to decide.
 */
export abstract class SsoConnectionRoutingRepository {
  /** The connections holding this domain plus their replacement partners; empty when none does. */
  abstract findDomainConnections(input: { domain: string }): Promise<SsoConnectionState[]>;
  /** Every connection not yet discarded or torn down, oldest first. */
  abstract findLiveConnections(): Promise<SsoConnectionState[]>;
}
