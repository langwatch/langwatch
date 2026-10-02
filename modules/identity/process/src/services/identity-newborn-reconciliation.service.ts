import { createLogger } from "@langwatch/observability";
import { Temporal, nowInstant } from "@langwatch/time";

import type { IdentityReservationRepository } from "../repositories/identity-reservations.repository.ts";

const logger = createLogger("langwatch:identity:newborn-reconciliation");

/** How long an address lock may stand with no live identifier behind it before it is reaped. */
export const IDENTITY_NEWBORN_ABANDONED_AFTER_MS = 60 * 60 * 1000;

/** One pass's bound, so a sweep never becomes the pass that never ends. */
const MAX_SWEPT_PER_PASS = 200;

export interface IdentityNewbornReconciliationDeps {
  /** The address lock (ADR-116 §6), for the claims whose fact never landed. */
  reservations: IdentityReservationRepository;
  now?: () => number;
  abandonedAfterMs?: number;
}

export interface IdentityNewbornSweepSummary {
  /** Address locks released because no live identifier ever backed them. */
  locksReaped: number;
}

/**
 * The address-lock reaper, run on the migration pass. A ceremony claims its
 * lock before the fact is stated, so one that claimed and then failed leaves a
 * lock no live identifier holds; this releases it (ADR-116 §6).
 */
export class IdentityNewbornReconciliationService {
  static create(deps: IdentityNewbornReconciliationDeps): IdentityNewbornReconciliationService {
    return new IdentityNewbornReconciliationService(deps);
  }

  private readonly now: () => number;
  private readonly abandonedAfterMs: number;

  private constructor(private readonly deps: IdentityNewbornReconciliationDeps) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
    this.abandonedAfterMs = deps.abandonedAfterMs ?? IDENTITY_NEWBORN_ABANDONED_AFTER_MS;
  }

  async runPass(): Promise<IdentityNewbornSweepSummary> {
    const summary: IdentityNewbornSweepSummary = { locksReaped: await this.reapAddressLocks() };
    if (summary.locksReaped > 0) logger.info(summary, "reaped orphaned identifier address locks");

    return summary;
  }

  private async reapAddressLocks(): Promise<number> {
    try {
      return await this.deps.reservations.reapOrphans({
        olderThan: Temporal.Instant.fromEpochMilliseconds(this.now() - this.abandonedAfterMs),
        limit: MAX_SWEPT_PER_PASS,
      });
    } catch (error) {
      logger.warn(
        { error },
        "could not reap orphaned identifier address locks; the next pass retries",
      );

      return 0;
    }
  }
}
