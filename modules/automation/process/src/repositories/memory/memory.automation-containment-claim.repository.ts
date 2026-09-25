import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import {
  AutomationContainmentClaimRepository,
  CONTAINMENT_CLAIM_KSUID_RESOURCE,
  CONTAINMENT_CLAIM_TTL_SECONDS,
} from "../automation-containment-claim.repository.ts";
import type { ClaimLease } from "../automation-runaway.repository.ts";

const CLAIM_SWEEP_INTERVAL_MS = 60_000;

/** Claims held by this process alone: a notice goes out once per pod rather than not at all. */
export class MemoryAutomationContainmentClaimRepository extends AutomationContainmentClaimRepository {
  static create(): MemoryAutomationContainmentClaimRepository {
    return new MemoryAutomationContainmentClaimRepository();
  }

  private readonly claims = new Map<string, { token: string; expiresAt: number }>();

  private lastSweepAt = 0;

  private constructor() {
    super();
  }

  claimOnce(
    key: string,
    ttlSeconds = CONTAINMENT_CLAIM_TTL_SECONDS,
  ): Promise<ClaimLease | "already-claimed"> {
    const now = nowInstant().epochMilliseconds;
    this.sweepExpired(now);
    const existing = this.claims.get(key);
    if (existing !== undefined && existing.expiresAt > now)
      return Promise.resolve("already-claimed");

    const token = generate(CONTAINMENT_CLAIM_KSUID_RESOURCE).toString();
    this.claims.set(key, { token, expiresAt: now + ttlSeconds * 1000 });
    return Promise.resolve({ key, token });
  }

  releaseClaim(lease: ClaimLease): Promise<void> {
    if (this.claims.get(lease.key)?.token === lease.token) this.claims.delete(lease.key);
    return Promise.resolve();
  }

  private sweepExpired(now: number): void {
    if (now - this.lastSweepAt < CLAIM_SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;
    for (const [key, claim] of this.claims) {
      if (claim.expiresAt <= now) this.claims.delete(key);
    }
  }
}
