import type { AgentSlug } from "@langwatch/contracts/agent-onboarding";
import type { EphemeralAccount } from "../domain/account.js";
import type { ClaimHandoff } from "../domain/handoff.js";

/**
 * Every seam this package needs from the outside world, in one file — the
 * same shape as `app/ports.go` in the Go services. Adapters implement these;
 * services only ever see these.
 */

/** Injected so lifecycle arithmetic is testable without freezing global time. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface CreateEphemeralAccountParams {
  userId: string;
  organizationId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  agent: AgentSlug;
  claimTokenHash: string;
  fingerprintHash: string | null;
  ipHash: string | null;
  provisionedAt: Date;
  ingestionStopsAt: Date;
  deleteAfter: Date;
}

export interface EphemeralAccountRepository {
  create(params: CreateEphemeralAccountParams): Promise<EphemeralAccount>;

  /** The claim token is the capability — this is the only lookup that matters
   *  for an unauthenticated caller. */
  findByClaimTokenHash(
    claimTokenHash: string,
  ): Promise<EphemeralAccount | null>;

  findById(id: string): Promise<EphemeralAccount | null>;

  /**
   * Attach an identity and clear both deadlines, but only while the account is
   * still unclaimed. Returns null when another caller got there first.
   *
   * The unclaimed condition lives in the UPDATE, not in a service-side check:
   * two browser tabs approving the same handoff would otherwise both succeed,
   * and the reaper racing a claim would resolve arbitrarily instead of in the
   * claim's favour.
   */
  markClaimed(params: {
    id: string;
    userId: string;
    claimedAt: Date;
  }): Promise<EphemeralAccount | null>;
}

export interface HandoffStore {
  put(params: {
    codeHash: string;
    handoff: ClaimHandoff;
    ttlSeconds: number;
  }): Promise<void>;

  get(codeHash: string): Promise<ClaimHandoff | null>;

  /** Flip to approved, recording who approved. Null if it vanished or was
   *  already approved. */
  approve(params: {
    codeHash: string;
    userId: string;
  }): Promise<ClaimHandoff | null>;

  /** Single-use: a successful exchange removes the record. */
  consume(codeHash: string): Promise<void>;

  /**
   * Whether this poll is allowed to proceed, given the minimum interval.
   * Lives on the store because it is one round-trip against the same key —
   * a separate limiter would double the latency of every poll.
   */
  allowPoll(params: {
    codeHash: string;
    intervalSeconds: number;
  }): Promise<boolean>;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /**
   * Count one request against a bucket. Implementations throw when their
   * backing store is unreachable rather than returning `allowed: true` — the
   * caller decides whether that axis fails open or closed, and it is not a
   * decision an adapter should be making silently.
   */
  consume(params: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<RateLimitDecision>;
}

export interface ProvisionedWorkspace {
  /** The unclaimed placeholder that owns everything below. */
  userId: string;
  organizationId: string;
  teamId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  ingestionKey: { token: string; prefix: string };
}

export interface WorkspaceProvisioner {
  /**
   * Create the placeholder user, its organization, team, project and an
   * ingestion-only key.
   *
   * Atomic by contract: a partial failure must leave nothing behind, because
   * an orphaned org has no live owner to notice it and no deadline to reap it.
   */
  provision(params: {
    projectName: string;
    agent: AgentSlug;
  }): Promise<ProvisionedWorkspace>;

  /**
   * The claimer IS the placeholder — they proved it with a credential enrolled
   * against it. Clear `unclaimedAt` and fill in whatever identity they gave.
   * Ownership does not move, because it was already theirs; this is the cheap
   * path and the one the passkey flow takes.
   */
  promotePlaceholder(params: {
    placeholderUserId: string;
    email?: string | null;
    name?: string | null;
  }): Promise<void>;

  /**
   * The claimer is a different, already-real user (a CLI that was logged in as
   * somebody). Give them ownership and retire the placeholder, which has no
   * further purpose and must not linger as a second admin.
   */
  transferToExistingUser(params: {
    organizationId: string;
    placeholderUserId: string;
    claimingUserId: string;
  }): Promise<void>;
}
