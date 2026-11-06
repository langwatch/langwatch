import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { SeatEventSubscriptionRepository } from "../repositories/seat-event-subscription.repository.ts";

const logger = createLogger("langwatch:billing:seatLineLease");

/**
 * How long a seat line lease lasts. A holder that runs past it can overlap the next one, so it
 * outlasts any seat change's Stripe calls; a holder that stopped frees the line when it runs out.
 */
export const SEAT_LINE_LEASE_MS = 5 * 60 * 1000;
/** How often a waiting seat change asks for the lease again. */
const SEAT_LINE_POLL_MS = 250;

/** What holding the seat line found: the work's answer, or another holder kept it. */
export type SeatLineHold<T> = { held: true; value: T } | { held: false };

/**
 * One seat change or seat line repair at a time per subscription, around its Stripe read and
 * update (specs/licensing/seat-rotation.feature), through a lease on the subscription row.
 */
export class SeatLineLeaseService {
  private constructor(
    private readonly subscriptions: Pick<
      SeatEventSubscriptionRepository,
      "claimSeatLine" | "releaseSeatLine"
    >,
  ) {}

  static create({
    subscriptions,
  }: {
    subscriptions: Pick<SeatEventSubscriptionRepository, "claimSeatLine" | "releaseSeatLine">;
  }): SeatLineLeaseService {
    return new SeatLineLeaseService(subscriptions);
  }

  /** Runs `work` holding the lease, asking again for up to `waitMs` while another holds it. */
  async hold<T>({
    id,
    waitMs,
    work,
  }: {
    id: string;
    waitMs: number;
    work: () => Promise<T>;
  }): Promise<SeatLineHold<T>> {
    const deadline = nowInstant().epochMilliseconds + waitMs;
    let claim = await this.subscriptions.claimSeatLine({ id, leaseMs: SEAT_LINE_LEASE_MS });
    while (!claim.claimed && nowInstant().epochMilliseconds < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SEAT_LINE_POLL_MS));
      claim = await this.subscriptions.claimSeatLine({ id, leaseMs: SEAT_LINE_LEASE_MS });
    }
    if (!claim.claimed) return { held: false };
    try {
      return { held: true, value: await work() };
    } finally {
      await this.subscriptions
        .releaseSeatLine({ id, token: claim.token })
        .catch((error: unknown) => {
          // The lease runs out on its own; the next holder waits for it at most that long.
          logger.warn({ error, subscriptionId: id }, "seat line lease release failed");
        });
    }
  }
}
