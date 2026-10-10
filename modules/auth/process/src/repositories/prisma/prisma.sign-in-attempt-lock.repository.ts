import { NO_FAILED_ATTEMPTS, type LockoutState } from "@langwatch/auth-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import type { SignInAttemptLockRepository } from "../sign-in-attempt-lock.repository.ts";

const stateSelect = {
  failedCount: true,
  lockedUntil: true,
  consecutiveLockouts: true,
  heldForReview: true,
} as const;

/** The `SignInAttemptLock` table, which auth owns outright (GAC-09). */
export class PrismaSignInAttemptLockRepository
  extends PrismaRepository.for("SignInAttemptLock")
  implements SignInAttemptLockRepository
{
  static readonly create = this.factory((prisma) => new PrismaSignInAttemptLockRepository(prisma));

  async findState({ identifierHash }: { identifierHash: string }): Promise<LockoutState> {
    const row = await this.prisma.signInAttemptLock.findUnique({
      where: { identifierHash },
      select: stateSelect,
    });

    if (!row) return NO_FAILED_ATTEMPTS;

    return { ...row, lockedUntil: row.lockedUntil ? fromDate(row.lockedUntil) : null };
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
    const row = {
      failedCount: state.failedCount,
      lockedUntil: state.lockedUntil ? toDate(state.lockedUntil) : null,
      consecutiveLockouts: state.consecutiveLockouts,
      heldForReview: state.heldForReview,
      userId,
    };

    // An upsert rather than a read-then-write: two failures racing for one
    // address must not both insert, and the unique index on the hash is what
    // makes the second of them an update.
    await this.prisma.signInAttemptLock.upsert({
      where: { identifierHash },
      create: { identifierHash, ...row },
      update: row,
    });
  }

  async deleteByHash({ identifierHash }: { identifierHash: string }): Promise<number> {
    const { count } = await this.prisma.signInAttemptLock.deleteMany({
      where: { identifierHash },
    });

    return count;
  }

  async deleteForUser({ userId }: { userId: string }): Promise<number> {
    const { count } = await this.prisma.signInAttemptLock.deleteMany({ where: { userId } });

    return count;
  }

  async deleteSettled({ settledBefore }: { settledBefore: Instant }): Promise<number> {
    const settled = toDate(settledBefore);
    const { count } = await this.prisma.signInAttemptLock.deleteMany({
      where: {
        heldForReview: false,
        // The COUNT is why this waits rather than deleting the moment a lock
        // lifts: `failedCount` is what makes five failures over ten minutes
        // different from five over a year.
        updatedAt: { lt: settled },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: settled } }],
      },
    });

    return count;
  }
}
