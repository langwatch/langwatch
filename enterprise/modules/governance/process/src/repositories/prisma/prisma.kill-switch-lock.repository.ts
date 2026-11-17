// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ConcurrencyLimiter } from "@langwatch/limiter";
import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { KillSwitchLockRepository } from "../kill-switch-lock.repository.ts";

/** Holds the lock across a platform call; Prisma's 5s default is too short. */
const KILL_SWITCH_LOCK_TIMEOUT_MS = 60_000;
const KILL_SWITCH_LOCK_MAX_WAIT_MS = 10_000;

/** Per process: the locked body writes on other pooled connections, so cap how many pin one. */
const lockedRuns = new ConcurrencyLimiter({ maxConcurrent: 2 });

/** A transaction-scoped advisory lock keyed by the caller's key; the transaction writes nothing. */
export class PrismaKillSwitchLockRepository extends KillSwitchLockRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaKillSwitchLockRepository {
    return new PrismaKillSwitchLockRepository(prisma);
  }

  async withLock<T>({ key, run }: { key: string; run: () => Promise<T> }): Promise<T> {
    return lockedRuns.run({
      task: () =>
        this.prisma.$transaction(
          async (transaction) => {
            await transaction.$executeRaw` ${skipTenantCheck({
              // Advisory-lock helper, the key names one kill switch resource.
              SKIP_TENANT_CHECK: true,
            })}
SELECT pg_advisory_xact_lock(hashtextextended(${`kill-switch:${key}`}, 0))`;
            return run();
          },
          { timeout: KILL_SWITCH_LOCK_TIMEOUT_MS, maxWait: KILL_SWITCH_LOCK_MAX_WAIT_MS },
        ),
    });
  }
}
