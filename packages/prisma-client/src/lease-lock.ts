import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:postgres:lease");

/** How long a caller waits for the lease in all, and the pause between two tries. */
const DEFAULT_WAIT_MS = 15_000;
const RETRY_PAUSE_MS = { min: 20, max: 120 } as const;

/** A lease outlives its holder's crash by at most this long; a live holder renews it. */
export const LEASE_TTL_MS = 20_000;
export const RENEW_EVERY_MS = 5_000;

/** Another caller held the lease for the whole wait. */
export class LeaseBusyError extends Error {
  constructor() {
    super("the lease stayed held past the wait; try again");
    this.name = "LeaseBusyError";
  }
}

/** The lease row's three writes, each a short statement on its own connection. */
export interface LeaseStore {
  /** Takes the lease when it is free or expired; false when someone else holds it. */
  acquire(input: { holder: string; ttlMs: number }): Promise<boolean>;
  /** Pushes this holder's expiry out again; a lease taken over meanwhile is left alone. */
  renew(input: { holder: string; ttlMs: number }): Promise<void>;
  /** Drops this holder's lease, and only its own. */
  release(input: { holder: string }): Promise<void>;
}

/** What the wait needs from the outside world, so a test can hold it still. */
export interface LeaseDeps {
  wait: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
  newHolder: () => string;
}

const REAL_DEPS: LeaseDeps = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => nowInstant().epochMilliseconds,
  random: Math.random,
  newHolder: () => randomUUID(),
};

/**
 * Takes the lease for a new holder, waiting while someone else holds it, and answers the holder.
 * The caller renews it within LEASE_TTL_MS while it works and releases it after.
 */
export async function acquireLease({
  store,
  onBusy = () => new LeaseBusyError(),
  waitMs = DEFAULT_WAIT_MS,
  deps = REAL_DEPS,
}: {
  store: LeaseStore;
  /** The error a caller still waiting at the deadline gets; the owner names it for its users. */
  onBusy?: () => Error;
  waitMs?: number;
  deps?: LeaseDeps;
}): Promise<string> {
  const holder = deps.newHolder();
  const deadline = deps.now() + waitMs;
  while (!(await store.acquire({ holder, ttlMs: LEASE_TTL_MS }))) {
    if (deps.now() >= deadline) throw onBusy();
    const { min, max } = RETRY_PAUSE_MS;
    await deps.wait(min + deps.random() * (max - min));
  }
  return holder;
}

/**
 * Runs `work` while this caller alone holds the lease. No connection is held while `work`
 * runs: the lease is a row with an expiry, renewed while the work lasts and deleted after,
 * so a crashed holder frees it within LEASE_TTL_MS and waiters never pin the pool.
 */
export async function withLease<T>({
  store,
  work,
  onBusy,
  waitMs,
  deps,
}: {
  store: LeaseStore;
  work: () => Promise<T>;
  onBusy?: () => Error;
  waitMs?: number;
  deps?: LeaseDeps;
}): Promise<T> {
  const holder = await acquireLease({ store, onBusy, waitMs, deps });
  const renewal = setInterval(() => {
    store.renew({ holder, ttlMs: LEASE_TTL_MS }).catch((error: unknown) => {
      logger.warn({ error, holder }, "lease renewal failed; the lease may expire mid-work");
    });
  }, RENEW_EVERY_MS);
  try {
    return await work();
  } finally {
    clearInterval(renewal);
    await store.release({ holder });
  }
}
