import {
  afterFailedAttempt,
  IdentitySignInLockedOutError,
  type LockoutPolicy,
  type LockoutState,
  lockoutVerdict,
  NO_FAILED_ATTEMPTS,
  NO_LOCKOUT,
  signInIdentifierKey,
} from "@langwatch/identity";

/**
 * Locking an account after repeated failed sign-ins (GAC-09).
 * Spec: specs/identity/org-account-lockout.feature.
 *
 * The decision itself lives in `@langwatch/identity`'s `account-lockout`,
 * which is where the arithmetic is written down and tested. This service
 * supplies the evidence, carries the answer to the sign-in path, and owns the
 * three things the pure module cannot: which rule applies to the address in
 * front of it, that the address is hashed before it is stored, and that a
 * lock is recorded as evidence rather than only as a row.
 *
 * KEYED ON THE ADDRESS THAT WAS TYPED. Not on a user, and the difference is
 * the security property: an address with no account behind it is counted,
 * locked and refused exactly like one that resolves, so a lock-out cannot be
 * used to discover who has an account here. See the service's own
 * `policyFor` below for the one place that symmetry needed thought.
 *
 * No Prisma reaches in here. Every read and write is a port, composed in
 * `runtime.ts`, which is what lets the cases that matter be tested as states
 * rather than as twenty-five real sign-in attempts.
 */

/** Where the consecutive-failure state for one address lives. */
export interface LockoutStatePort {
  read(args: { identifierHash: string }): Promise<LockoutState | null>;
  write(args: {
    identifierHash: string;
    state: LockoutState;
    /** Whose account it was, when it was anybody's. */
    userId: string | null;
  }): Promise<void>;
  clear(args: { identifierHash: string }): Promise<void>;
  /** An administrator's release, which names a person rather than a hash. */
  clearForUser(args: { userId: string }): Promise<number>;
}

/** Which rule applies. */
export interface LockoutPolicyPort {
  /** The strictest rule among the organizations this person belongs to. */
  forUser(args: { userId: string }): Promise<LockoutPolicy>;
  /**
   * The strictest rule anybody on this installation has set.
   *
   * Two jobs. It is the rule applied to an address that resolves to nobody -
   * see `policyFor` - and, when it turns out to lock nobody at all, it is the
   * early-out that keeps this entire feature off the sign-in path for every
   * deployment that has not turned it on.
   */
  installationWide(): Promise<LockoutPolicy>;
}

/** Who an address belongs to, if anybody. */
export interface LockoutIdentityPort {
  userIdFor(args: { identifier: string }): Promise<string | null>;
}

/** A lock, written somewhere durable enough for an auditor to read later. */
export interface LockoutEvidencePort {
  /** A lock was taken. */
  locked(args: {
    userId: string | null;
    failedCount: number;
    consecutiveLockouts: number;
    lockedUntil: Date;
  }): Promise<void>;
  /**
   * The ceiling was reached, and this is an incident rather than another
   * lock. Separate from `locked` on purpose: an alert that fires on every
   * lock-out fires constantly and gets muted, which is how the one that
   * mattered is missed.
   */
  escalated(args: {
    userId: string | null;
    consecutiveLockouts: number;
  }): Promise<void>;
}

export interface SignInLockoutDeps {
  state: LockoutStatePort;
  policy: LockoutPolicyPort;
  identity: LockoutIdentityPort;
  evidence: LockoutEvidencePort;
  /**
   * The address, keyed-hashed for storage.
   *
   * A KEYED hash, not a bare digest: without the key this table is a list of
   * every address anybody has ever tried to sign in as - every typo, and
   * every address with no account here - recoverable by anyone who can dump
   * it against a dictionary of email addresses.
   */
  hashIdentifier: (key: string) => string;
  now: () => Date;
}

export class SignInLockoutService {
  constructor(private readonly deps: SignInLockoutDeps) {}

  /**
   * Refuses the attempt when this address is locked out.
   *
   * Throws `IdentitySignInLockedOutError`, whose copy says nothing about
   * whether the address has an account and nothing about which half of the
   * credentials was right - telling somebody their password was correct but
   * the account is locked would turn the lock-out screen into a password
   * oracle.
   */
  async refuseIfLockedOut({ identifier }: { identifier: string }) {
    const state = await this.stateOf({ identifier });
    if (state === null) return;

    const verdict = lockoutVerdict({ state, now: this.deps.now() });
    if (!verdict.locked) return;

    throw new IdentitySignInLockedOutError(
      verdict.held
        ? `held after ${state.consecutiveLockouts} consecutive lock-outs`
        : `locked until ${verdict.until?.toISOString() ?? "unknown"}`,
    );
  }

  /**
   * Counts one failed attempt, and takes a lock if it is the one that trips
   * the threshold.
   *
   * Every credential counts into the same number - a password, a one-time
   * code, a backup code, a passkey. This method never learns which it was,
   * and that is deliberate: a counter that could tell them apart is one
   * somebody would eventually give a budget each.
   */
  async recordFailure({ identifier }: { identifier: string }) {
    const key = signInIdentifierKey(identifier);
    const identifierHash = this.deps.hashIdentifier(key);
    const userId = await this.deps.identity.userIdFor({ identifier: key });
    const policy = await this.policyFor({ userId });
    if (policy.afterFailedAttempts <= 0) return;

    const before =
      (await this.deps.state.read({ identifierHash })) ?? NO_FAILED_ATTEMPTS;
    const after = afterFailedAttempt({
      state: before,
      policy,
      now: this.deps.now(),
    });
    await this.deps.state.write({ identifierHash, state: after, userId });

    // A lock was taken on THIS attempt. Both halves matter: the count going
    // up is what distinguishes taking a lock from merely failing again, and
    // the date is what a lock always has - narrowed here rather than asserted
    // so the evidence port can keep saying `Date` and mean it.
    const lockedUntil = after.lockedUntil;
    if (
      after.consecutiveLockouts <= before.consecutiveLockouts ||
      lockedUntil === null
    ) {
      return;
    }

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
  async recordSuccess({ identifier }: { identifier: string }) {
    const identifierHash = this.deps.hashIdentifier(
      signInIdentifierKey(identifier),
    );
    // `afterSuccessfulSignIn()` is the empty state, and a clear is how that
    // state is stored: the row has stopped meaning anything, and keeping it
    // is how this table grows a row per address anybody has ever signed in
    // as.
    await this.deps.state.clear({ identifierHash });
  }

  /**
   * The owner proved they hold the mailbox, so a hold is cleared.
   *
   * The way out that does not need an administrator, and the reason a held
   * account is not a denial of service anyone can inflict by typing a
   * colleague's address wrong often enough: clearing it costs mailbox
   * control, which is exactly what the attacker does not have.
   */
  async clearAfterMailboxProof({ identifier }: { identifier: string }) {
    const identifierHash = this.deps.hashIdentifier(
      signInIdentifierKey(identifier),
    );
    // `afterMailboxProof()` is the empty state, stored as a clear for the
    // same reason `recordSuccess` does.
    await this.deps.state.clear({ identifierHash });
  }

  /** An administrator releases somebody their organization holds. */
  async release({ userId }: { userId: string }): Promise<number> {
    return await this.deps.state.clearForUser({ userId });
  }

  /**
   * This address's state, or null when nothing on this installation locks
   * anybody.
   *
   * The early-out is the first question asked rather than the last, so a
   * deployment where no organization has set a threshold pays nothing at all
   * on the sign-in path - not a state read, not a hash, not an identity
   * lookup.
   */
  private async stateOf({
    identifier,
  }: {
    identifier: string;
  }): Promise<LockoutState | null> {
    const anybody = await this.deps.policy.installationWide();
    if (anybody.afterFailedAttempts <= 0) return null;

    const identifierHash = this.deps.hashIdentifier(
      signInIdentifierKey(identifier),
    );
    return await this.deps.state.read({ identifierHash });
  }

  /**
   * Which rule governs this address.
   *
   * An address that resolves is governed by the strictest rule among the
   * organizations its owner belongs to, which is what keeps one customer's
   * setting from locking another customer's members out.
   *
   * An address that resolves to NOBODY is governed by the strictest rule
   * anybody on this installation has set, and that fallback is load-bearing
   * rather than a convenience. An unknown address belongs to no organization,
   * so there is no rule of its own to apply; leaving it unlocked would make
   * "never locks" the signal that an address has no account here, which is
   * precisely the enumeration this feature is careful not to reintroduce.
   *
   * What that leaves is written down in the spec rather than hidden here: on
   * an installation where at least one organization locks, an address that
   * never locks is thereby known to belong to an organization that does not.
   * That residue is accepted, at five attempts a guess, over the alternative
   * of applying one customer's policy to another's members.
   */
  private async policyFor({
    userId,
  }: {
    userId: string | null;
  }): Promise<LockoutPolicy> {
    if (userId === null) return await this.deps.policy.installationWide();
    const policy = await this.deps.policy.forUser({ userId });
    return policy.afterFailedAttempts > 0 ? policy : NO_LOCKOUT;
  }
}
