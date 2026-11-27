// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ConcurrencyLimiter } from "@langwatch/limiter";
import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type KillSwitchLockHold,
  KillSwitchLockRepository,
} from "../kill-switch-lock.repository.ts";

const KILL_SWITCH_LOCK_MAX_WAIT_MS = 10_000;

/**
 * `timeoutMs` holds the lock across a platform call (Prisma's 5s default is too short); the
 * body's signal aborts `fenceMs` before the transaction, and so the lock, can lapse.
 */
type KillSwitchLockTiming = { timeoutMs: number; fenceMs: number };
const KILL_SWITCH_LOCK_TIMING: KillSwitchLockTiming = { timeoutMs: 60_000, fenceMs: 15_000 };

/** Per process: the locked body writes on other pooled connections, so cap how many pin one. */
const lockedRuns = new ConcurrencyLimiter({ maxConcurrent: 2 });

/**
 * A transaction-scoped advisory lock keyed by the caller's key; the transaction writes nothing.
 * A body still running near the timeout sees its signal aborted and checks it before each write.
 */
export class PrismaKillSwitchLockRepository extends KillSwitchLockRepository {
  private constructor(
    private readonly prisma: PrismaClient,
    private readonly timing: KillSwitchLockTiming,
  ) {
    super();
  }

  static create(
    prisma: PrismaClient,
    timing: KillSwitchLockTiming = KILL_SWITCH_LOCK_TIMING,
  ): PrismaKillSwitchLockRepository {
    return new PrismaKillSwitchLockRepository(prisma, timing);
  }

  async withLock<T>({
    key,
    run,
  }: {
    key: string;
    run: (hold: KillSwitchLockHold) => Promise<T>;
  }): Promise<T> {
    return lockedRuns.run({
      task: () => {
        // Counted from the call: Prisma's timeout can include waiting for a connection, and the lock.
        const startedAt = Date.now();
        return this.prisma.$transaction(
          async (transaction) => {
            await transaction.$executeRaw` ${skipTenantCheck({
              // Advisory-lock helper, the key names one kill switch resource.
              SKIP_TENANT_CHECK: true,
            })}
SELECT pg_advisory_xact_lock(hashtextextended(${`kill-switch:${key}`}, 0))`;
            const fence = new AbortController();
            const lapse = () => fence.abort(new Error(`kill switch lock ${key} is about to lapse`));
            const { timeoutMs, fenceMs } = this.timing;
            const left = timeoutMs - fenceMs - (Date.now() - startedAt);
            if (left <= 0) lapse();
            const timer = setTimeout(lapse, Math.max(left, 0));
            try {
              return await run({ signal: fence.signal });
            } finally {
              clearTimeout(timer);
            }
          },
          { timeout: this.timing.timeoutMs, maxWait: KILL_SWITCH_LOCK_MAX_WAIT_MS },
        );
      },
    });
  }
}
