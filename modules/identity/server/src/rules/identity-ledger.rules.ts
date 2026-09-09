import type {
  IdentityCommand,
  IdentityFact,
  IdentityFactInput,
} from "@langwatch/identity-contract";

/**
 * THE emission seam — the identity analogue of the grants write repository's its reads and run the
 * verbs (ADR-115 §3). By the time a service reaches this port it has taken
 * The app implements it with ADR-101 §2's pinned order — envelope, durable
 */
export interface IdentityLedger {
  commit(args: { command: IdentityCommand; facts: IdentityFactInput[] }): Promise<IdentityFact[]>;
}
