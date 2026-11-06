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

/** What holding the seat line found: the work's answer, or another holder kept or took it. */
export type SeatLineHold<T> = { held: true; value: T } | { held: false };

/** Asked before every Stripe write: renews the lease, or stops the work when it was lost. */
export type SeatLineGuard = { beforeWrite: () => Promise<void> };

/** The lease ran out and another holder took it; the work stops without writing. */
class SeatLineLeaseLostError extends Error {
  constructor() {
    super("The seat line lease was taken over");
    this.name = "SeatLineLeaseLostError";
  }
}

/**
 * One seat change or seat line repair at a time per subscription, around its Stripe read and
 * update (specs/licensing/seat-rotation.feature), through a lease on the subscription row.
 */
export class SeatLineLeaseService {
  private constructor(
    private readonly subscriptions: Pick<
      SeatEventSubscriptionRepository,
      "claimSeatLine" | "renewSeatLine" | "releaseSeatLine"
    >,
  ) {}

  static create({
    subscriptions,
  }: {
    subscriptions: Pick<
      SeatEventSubscriptionRepository,
      "claimSeatLine" | "renewSeatLine" | "releaseSeatLine"
    >;
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
    work: (guard: SeatLineGuard) => Promise<T>;
  }): Promise<SeatLineHold<T>> {
    const deadline = nowInstant().epochMilliseconds + waitMs;
    let claim = await this.subscriptions.claimSeatLine({ id, leaseMs: SEAT_LINE_LEASE_MS });
    while (!claim.claimed && nowInstant().epochMilliseconds < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SEAT_LINE_POLL_MS));
      claim = await this.subscriptions.claimSeatLine({ id, leaseMs: SEAT_LINE_LEASE_MS });
    }
    if (!claim.claimed) return { held: false };
    const { token } = claim;
    // Between this renewal and the Stripe call it guards, a stalled holder can still outlive
    // the fresh lease; the lease is minutes long and the gap is one awaited round trip.
    const beforeWrite = async () => {
      const renewed = await this.subscriptions.renewSeatLine({
        id,
        token,
        leaseMs: SEAT_LINE_LEASE_MS,
      });
      if (!renewed) throw new SeatLineLeaseLostError();
    };
    try {
      return { held: true, value: await work({ beforeWrite }) };
    } catch (error) {
      if (!(error instanceof SeatLineLeaseLostError)) throw error;
      logger.warn({ subscriptionId: id }, "seat line lease taken over; stopped before writing");
      return { held: false };
    } finally {
      await this.subscriptions.releaseSeatLine({ id, token }).catch((error: unknown) => {
        // The lease runs out on its own; the next holder waits for it at most that long.
        logger.warn({ error, subscriptionId: id }, "seat line lease release failed");
      });
    }
  }
}
