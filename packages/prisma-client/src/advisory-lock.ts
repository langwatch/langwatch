import { nowInstant } from "@langwatch/time";

import type { PrismaClient } from "./generated/client.ts";
import { skipTenantCheck } from "./multi-tenancy-guard.ts";

/** How long a caller waits for the lock in all, and the pause between two tries. */
const DEFAULT_WAIT_MS = 15_000;
const RETRY_PAUSE_MS = { min: 20, max: 120 } as const;

/** The holding transaction outlives the work it guards; the work's writes run beside it. */
const HOLD_TIMEOUT_MS = 30_000;

/** Another caller held the lock for the whole wait. */
export class AdvisoryLockBusyError extends Error {
  constructor(readonly key: string) {
    super(`advisory lock "${key}" stayed held past the wait; try again`);
    this.name = "AdvisoryLockBusyError";
  }
}

/** What the lock needs from the outside world, so a test can hold it still. */
export interface AdvisoryLockDeps {
  wait: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

const REAL_DEPS: AdvisoryLockDeps = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => nowInstant().epochMilliseconds,
  random: Math.random,
};

type Attempt<T> = { held: false } | { held: true; value: T };

/**
 * Runs `work` while this caller alone holds a transaction-scoped advisory lock on `key`.
 * A waiter tries, gives its connection back and tries again, so queued callers never pin
 * the pool the work's own writes need. The lock ends with its transaction, crash included.
 */
export async function withAdvisoryLock<T>({
  prisma,
  key,
  work,
  waitMs = DEFAULT_WAIT_MS,
  deps = REAL_DEPS,
  onBusy = () => new AdvisoryLockBusyError(key),
}: {
  prisma: Pick<PrismaClient, "$transaction">;
  key: string;
  work: () => Promise<T>;
  waitMs?: number;
  /** The error a caller still waiting at the deadline gets; the owner names it for its users. */
  onBusy?: () => Error;
  deps?: AdvisoryLockDeps;
}): Promise<T> {
  const deadline = deps.now() + waitMs;
  for (;;) {
    const attempt: Attempt<T> = await prisma.$transaction(
      async (transaction) => {
        const [row] = await transaction.$queryRaw<{ locked: boolean }[]>`${skipTenantCheck({
          // The key names its own tenant; the lock reads no table.
          SKIP_TENANT_CHECK: true,
        })}
SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
        if (!row?.locked) return { held: false };
        return { held: true, value: await work() };
      },
      { timeout: HOLD_TIMEOUT_MS, maxWait: waitMs },
    );
    if (attempt.held) return attempt.value;
    if (deps.now() >= deadline) throw onBusy();
    const { min, max } = RETRY_PAUSE_MS;
    await deps.wait(min + deps.random() * (max - min));
  }
}
