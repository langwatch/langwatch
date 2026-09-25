import type { ClaimLease } from "./automation-runaway.repository.ts";

export const CONTAINMENT_CLAIM_TTL_SECONDS = 90_000;

/** The KSUID resource a claim's fencing token is minted under; compared, never persisted. */
export const CONTAINMENT_CLAIM_KSUID_RESOURCE = "automationclaim";

/** The once-only leases runaway containment takes before it pauses or mails. */
export abstract class AutomationContainmentClaimRepository {
  abstract claimOnce(key: string, ttlSeconds?: number): Promise<ClaimLease | "already-claimed">;
  abstract releaseClaim(lease: ClaimLease): Promise<void>;
}
