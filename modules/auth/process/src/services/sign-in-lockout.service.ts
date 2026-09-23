import {
  afterFailedAttempt,
  lockoutVerdict,
  NO_LOCKOUT,
  signInIdentifierKey,
  SignInLockedOutError,
  strictestLockoutPolicy,
  type LockoutPolicy,
} from "@langwatch/auth-contract";
import type { Instant } from "@langwatch/time";

import type { SignInAttemptLockRepository } from "../repositories/sign-in-attempt-lock.repository.ts";
import type { SignInSecuritySettingsRepository } from "../repositories/sign-in-security-settings.repository.ts";

/**
 * Locking an address after repeated failed sign-ins (GAC-09). The arithmetic
 * is the contract's `account-lockout`; this supplies the evidence, hashes the
 * address, and decides which rule applies to the one in front of it.
 */

/** Who an address belongs to, if anybody. */
export interface SignInLockoutDirectory {
  findUserIdFor(input: { identifier: string }): Promise<string | null>;
}

/** A lock, written somewhere an auditor can still read it months later. */
export interface SignInLockoutEvidence {
  locked(input: {
    userId: string | null;
    failedCount: number;
    consecutiveLockouts: number;
    lockedUntil: Instant;
  }): Promise<void>;
  /** The ceiling was reached: an incident rather than another lock. An alert
   *  that fires on every lock-out fires constantly and gets muted. */
  escalated(input: { userId: string | null; consecutiveLockouts: number }): Promise<void>;
}

export interface SignInLockoutDeps {
  locks: SignInAttemptLockRepository;
  settings: SignInSecuritySettingsRepository;
  directory: SignInLockoutDirectory;
  evidence: SignInLockoutEvidence;
  /** The address, keyed-hashed for storage. Keyed, because a bare digest of
   *  an address is recoverable against a dictionary of email addresses. */
  hashIdentifier: (key: string) => string;
  now: () => Instant;
}

export class SignInLockoutService {
  static create(deps: SignInLockoutDeps): SignInLockoutService {
    return new SignInLockoutService(deps);
  }

  private constructor(private readonly deps: SignInLockoutDeps) {}

  /**
   * Refuses the attempt when this address is locked out. The refusal says
   * nothing about whether the address has an account and nothing about which
   * half of the credentials was right: either turns the screen into an oracle.
   */
  async refuseIfLockedOut({ identifier }: { identifier: string }): Promise<void> {
    const installationWide = await this.installationPolicy();
    // The early-out is the FIRST question, so a deployment where nobody has
    // set a threshold pays nothing on the sign-in path — no hash, no state
    // read, no directory lookup.
    if (installationWide.afterFailedAttempts <= 0) return;

    const state = await this.deps.locks.findState({
      identifierHash: this.hashOf(identifier),
    });
    const verdict = lockoutVerdict({ state, now: this.deps.now() });
    if (!verdict.locked) return;

    throw new SignInLockedOutError(
      verdict.held
        ? `held after ${state.consecutiveLockouts} consecutive lock-outs`
        : `locked until ${verdict.until?.toString() ?? "unknown"}`,
    );
  }

  /**
   * Counts one failed attempt, and takes a lock if it is the one that trips
   * the threshold. Every credential counts into the same number: a budget
   * each would hand an attacker one budget per factor.
   */
  async recordFailure({ identifier }: { identifier: string }): Promise<void> {
    const identifierHash = this.hashOf(identifier);
    const userId = await this.deps.directory.findUserIdFor({
      identifier: signInIdentifierKey(identifier),
    });
    const policy = await this.policyFor({ userId });
    if (policy.afterFailedAttempts <= 0) return;

    const before = await this.deps.locks.findState({ identifierHash });
    const after = afterFailedAttempt({ state: before, policy, now: this.deps.now() });
    await this.deps.locks.save({ identifierHash, state: after, userId });

    // A lock was taken on THIS attempt: the count going up is what separates
    // taking a lock from merely failing again, and the stamp is narrowed here
    // rather than asserted so the evidence port can keep requiring one.
    const lockedUntil = after.lockedUntil;
    if (after.consecutiveLockouts <= before.consecutiveLockouts || lockedUntil === null) return;

    await this.deps.evidence.locked({
      userId,
      failedCount: policy.afterFailedAttempts,
      consecutiveLockouts: after.consecutiveLockouts,
      lockedUntil,
    });
    if (after.heldForReview && !before.heldForReview) {
      await this.deps.evidence.escalated({
        userId,
        consecutiveLockouts: after.consecutiveLockouts,
      });
    }
  }

  /** Somebody got in. Everything resets, the count of locks included. */
  async recordSuccess({ identifier }: { identifier: string }): Promise<void> {
    await this.deps.locks.deleteByHash({ identifierHash: this.hashOf(identifier) });
  }

  /**
   * The owner proved they hold the mailbox, so a hold is cleared — the way
   * out that needs no administrator, and what stops a hold being a denial of
   * service anyone can inflict by mistyping a colleague's address.
   */
  async clearAfterMailboxProof({ identifier }: { identifier: string }): Promise<void> {
    await this.deps.locks.deleteByHash({ identifierHash: this.hashOf(identifier) });
  }

  /** An administrator releases somebody their organization holds. */
  async release({ userId }: { userId: string }): Promise<number> {
    return this.deps.locks.deleteForUser({ userId });
  }

  /** The rows that have stopped meaning anything. Releases nothing. */
  async reapSettledLocks({ settledBefore }: { settledBefore: Instant }): Promise<number> {
    return this.deps.locks.deleteSettled({ settledBefore });
  }

  private hashOf(identifier: string): string {
    return this.deps.hashIdentifier(signInIdentifierKey(identifier));
  }

  private async installationPolicy(): Promise<LockoutPolicy> {
    const configured = await this.deps.settings.findConfigured();

    return strictestLockoutPolicy(configured.map((rule) => rule.lockout));
  }

  /**
   * Which rule governs this address. One that resolves takes the strictest
   * among its owner's organizations; one resolving to NOBODY belongs to none,
   * so the installation's strictest stands in - never locking is a signal.
   */
  private async policyFor({ userId }: { userId: string | null }): Promise<LockoutPolicy> {
    if (userId === null) return this.installationPolicy();

    const governing = await this.deps.settings.findForUser({ userId });
    const policy = strictestLockoutPolicy(governing.map((rule) => rule.lockout));

    return policy.afterFailedAttempts > 0 ? policy : NO_LOCKOUT;
  }
}
