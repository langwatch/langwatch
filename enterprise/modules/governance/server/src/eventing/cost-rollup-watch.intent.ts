import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { CostRollupDayComparer } from "../app/governance.members.ts";

const logger = createLogger("langwatch:governance:cost-rollup:watch");

/**
 * How many looks one day's comparison gets before the outbox retires it.
 * Named rather than inlined into the outbox policy because the handler
 * reads it too, so two literals can't let "last" drift apart silently.
 */
export const COST_ROLLUP_WATCH_MAX_ATTEMPTS = 5;

/**
 * A comparison disagreed with looks left, so it is not drift yet — thrown to
 * spend a rung of the outbox ladder; a quiet return would clear the day for
 * good. A plain `Error`, not `HandledError`: nothing here reaches a customer.
 */
export class CostRollupCheckUnsettledError extends Error {
  readonly day: string;
  readonly attempt: number;
  readonly mismatchedCells: number;

  constructor({
    day,
    attempt,
    mismatchedCells,
  }: {
    day: string;
    attempt: number;
    mismatchedCells: number;
  }) {
    super(
      `Governance cost rollup for ${day} disagrees on ${mismatchedCells} cell(s) after look ${attempt} of ${COST_ROLLUP_WATCH_MAX_ATTEMPTS}; looking again`,
    );
    this.name = "CostRollupCheckUnsettledError";
    this.day = day;
    this.attempt = attempt;
    this.mismatchedCells = mismatchedCells;
  }
}

/**
 * Nothing here is defaulted: a comparison that guessed the tenant, the day or
 * the lane would compare the wrong thing and report the answer as fact.
 */
export const compareCostRollupDaySchema = z.object({
  /** The organization's hidden governance project — the storage partition. */
  tenantId: z.string(),
  /** UTC `YYYY-MM-DD`. */
  day: z.string(),
  /** Which lane the day is compared in; the comparer names it. */
  costSource: z.string().min(1),
});

export type CompareCostRollupDayPayload = z.infer<typeof compareCostRollupDaySchema>;

/**
 * Where a disagreement becomes drift, or does not — the attempt number is
 * the only thing separating the two, since a fold that is behind catches up
 * between looks and drift does not. Failures propagate so the outbox retries.
 */
export class CostRollupWatchIntent {
  private constructor(private readonly comparer: CostRollupDayComparer) {}

  static create(comparer: CostRollupDayComparer): CostRollupWatchIntent {
    return new CostRollupWatchIntent(comparer);
  }

  async execute(payload: CompareCostRollupDayPayload, context: { attempt: number }): Promise<void> {
    const look = await this.comparer.compareDay({
      tenantId: payload.tenantId,
      day: payload.day,
    });

    // Two ways a look is inconclusive, and both buy another one: the figures
    // differ, or the summary is PROVABLY mid-fold while they happen to agree.
    // Agreement over a summary still catching up is a coincidence, not a
    // verdict, and clearing the day on it is permanent.
    if (look.mismatchedCells === 0 && look.cellsBehind === 0) return;

    if (context.attempt < COST_ROLLUP_WATCH_MAX_ATTEMPTS) {
      logger.warn(
        {
          tenantId: payload.tenantId,
          day: payload.day,
          cost_source: payload.costSource,
          attempt: context.attempt,
          of_attempts: COST_ROLLUP_WATCH_MAX_ATTEMPTS,
          mismatched_cells: look.mismatchedCells,
          // Non-zero names the reason outright; zero alongside a mismatch
          // means the watermarks look level, which proves nothing and is
          // precisely why this waits anyway.
          cells_behind: look.cellsBehind,
          lag_ms: look.lagMs,
        },
        look.mismatchedCells > 0
          ? "Governance cost rollup disagrees with its events; looking again before calling it drift"
          : "Governance cost rollup agrees with its events but has not folded all of them; looking again before trusting it",
      );
      throw new CostRollupCheckUnsettledError({
        day: payload.day,
        attempt: context.attempt,
        mismatchedCells: look.mismatchedCells,
      });
    }

    // The last look, and whatever it found stands — including a missing
    // summary row, since money on the log that never folded is what the counter
    // is for. The intent COMPLETES: throwing here would retire the row as dead
    // and file a real finding under "the outbox broke", where nobody reads it.
    look.reportDrift();

    // The ladder is spent and the figures still agree, so the fold has stopped
    // rather than slowed. Said once, here, because this is where the day is
    // cleared and nothing will ask about it again.
    if (look.mismatchedCells === 0) {
      logger.warn(
        {
          tenantId: payload.tenantId,
          day: payload.day,
          cost_source: payload.costSource,
          cells_behind: look.cellsBehind,
          lag_ms: look.lagMs,
        },
        "Governance cost rollup still had not folded every charge of the day on the last look; its figures agreed and the day is being cleared on that",
      );
    }
  }
}
