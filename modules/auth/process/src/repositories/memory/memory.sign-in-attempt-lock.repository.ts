import { NO_FAILED_ATTEMPTS, type LockoutState } from "@langwatch/auth-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { SignInAttemptLockRepository } from "../sign-in-attempt-lock.repository.ts";

type StoredLock = { state: LockoutState; userId: string | null; updatedAt: Instant };

/** In-process twin of the `SignInAttemptLock` rows (GAC-09). */
export class MemorySignInAttemptLockRepository implements SignInAttemptLockRepository {
  readonly rows = new Map<string, StoredLock>();

  readonly #now: () => Instant;

  private constructor(now: () => Instant) {
    this.#now = now;
  }

  static create(options: { now?: () => Instant } = {}): MemorySignInAttemptLockRepository {
    return new MemorySignInAttemptLockRepository(options.now ?? nowInstant);
  }

  async findState({ identifierHash }: { identifierHash: string }): Promise<LockoutState> {
    return this.rows.get(identifierHash)?.state ?? NO_FAILED_ATTEMPTS;
  }

  async save({
    identifierHash,
    state,
    userId,
  }: {
    identifierHash: string;
    state: LockoutState;
    userId: string | null;
  }): Promise<void> {
    this.rows.set(identifierHash, { state, userId, updatedAt: this.#now() });
  }

  async deleteByHash({ identifierHash }: { identifierHash: string }): Promise<number> {
    return this.rows.delete(identifierHash) ? 1 : 0;
  }

  async deleteForUser({ userId }: { userId: string }): Promise<number> {
    let removed = 0;
    for (const [hash, row] of this.rows) {
      if (row.userId !== userId) continue;
      this.rows.delete(hash);
      removed += 1;
    }

    return removed;
  }

  async deleteSettled({ settledBefore }: { settledBefore: Instant }): Promise<number> {
    let removed = 0;
    const before = settledBefore.epochMilliseconds;
    for (const [hash, row] of this.rows) {
      if (row.state.heldForReview) continue;
      if (row.updatedAt.epochMilliseconds >= before) continue;
      const lockedUntil = row.state.lockedUntil;
      if (lockedUntil !== null && lockedUntil.epochMilliseconds >= before) continue;
      this.rows.delete(hash);
      removed += 1;
    }

    return removed;
  }
}
