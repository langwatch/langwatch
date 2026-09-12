import type { IdentityReservationRepository } from "@langwatch/identity-server";

/**
 * How long a lock is given before it reads as orphaned. Generously above any
 * ceremony's own latency: reaping early hands an address away from a
 * ceremony still in flight, and reaping late costs a few inert rows.
 */
export const IDENTITY_ADDRESS_LOCK_ORPHAN_AFTER_MS = 60 * 60 * 1000;

/** One pass's bound, so a reap never becomes the pass that never ends. */
const MAX_REAPED_PER_PASS = 200;

export interface IdentityAddressLockReaperDeps {
  /** The address lock (ADR-116 §6), for the claims whose fact never landed. */
  reservations: IdentityReservationRepository;
  now?: () => number;
  orphanAfterMs?: number;
}

export interface IdentityAddressLockSweepSummary {
  /** Address locks released because no live identifier ever backed them. */
  locksReaped: number;
}

/**
 * Address locks nothing backs (ADR-116 §6).
 *
 * `IdentityGuards` claims the lock BEFORE the fact is stated — that ordering
 * is the whole point, because it is what keeps a losing verification out of
 * the log and its single-use proof unburned. The cost of claiming first is
 * that a ceremony which claims and then fails leaves a lock on an address no
 * live identifier holds, and without this nobody could ever take that
 * address again.
 *
 * So the reap is a required companion to the lock rather than optional
 * hygiene, and it runs on the migration pass's cadence. The horizon is what
 * keeps it off a ceremony that is merely still in flight.
 *
 * Shaped like the backfill's pass: one bounded pass, a summary rather than a
 * promise of completion. It does not catch — the pass leg that calls it owns
 * that, so a reap that fails costs one pass and never the migrations beside
 * it.
 */
export class IdentityAddressLockReaperService {
  private readonly now: () => number;
  private readonly orphanAfterMs: number;

  constructor(private readonly deps: IdentityAddressLockReaperDeps) {
    this.now = deps.now ?? Date.now;
    this.orphanAfterMs =
      deps.orphanAfterMs ?? IDENTITY_ADDRESS_LOCK_ORPHAN_AFTER_MS;
  }

  async runPass(): Promise<IdentityAddressLockSweepSummary> {
    return {
      locksReaped: await this.deps.reservations.reapOrphans({
        olderThan: new Date(this.now() - this.orphanAfterMs),
        limit: MAX_REAPED_PER_PASS,
      }),
    };
  }
}
