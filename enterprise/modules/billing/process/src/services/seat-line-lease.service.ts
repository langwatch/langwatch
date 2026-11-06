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
/**
 * Stripe request timeout for one seat line write. With the client's one network retry a write
 * gives up within about two minutes, well inside the lease it renewed just before.
 */
export const SEAT_LINE_WRITE_TIMEOUT_MS = 60 * 1000;

/** What holding the seat line found: the work's answer, or another holder kept or took it. */
export type SeatLineHold<T> = { held: true; value: T } | { held: false };

/**
 * Wraps every Stripe write: renews the lease before it and checks it after. Lost before, the work
 * stops unwritten; lost after, the write may have overwritten the newer holder's, so it records a
 * reconcile for the seat line repair and stops.
 */
export type SeatLineGuard = {
  write: <R>(input: { quantity: number; send: () => Promise<R> }) => Promise<R>;
};

/** The lease ran out and another holder took it; the work stops there. */
export class SeatLineLeaseLostError extends Error {
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
      "claimSeatLine" | "renewSeatLine" | "releaseSeatLine" | "recordSeatLineReconcile"
    >,
  ) {}

  static create({
    subscriptions,
  }: {
    subscriptions: Pick<
      SeatEventSubscriptionRepository,
      "claimSeatLine" | "renewSeatLine" | "releaseSeatLine" | "recordSeatLineReconcile"
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
    const renew = () =>
      this.subscriptions.renewSeatLine({ id, token, leaseMs: SEAT_LINE_LEASE_MS });
    // Stripe has no conditional update: a write that stalls past the lease can still land after
    // a takeover. SEAT_LINE_WRITE_TIMEOUT_MS bounds that, and the check after it records a
    // reconcile the next repair pass settles against the newer holder's seat count.
    const guard: SeatLineGuard = {
      write: async ({ quantity, send }) => {
        if (!(await renew())) throw new SeatLineLeaseLostError();
        const sent = await send();
        if (!(await renew())) {
          await this.recordLateWrite({ id, quantity });
          throw new SeatLineLeaseLostError();
        }
        return sent;
      },
    };
    try {
      return { held: true, value: await work(guard) };
    } catch (error) {
      if (!(error instanceof SeatLineLeaseLostError)) throw error;
      logger.warn({ subscriptionId: id }, "seat line lease taken over; the work stopped");
      return { held: false };
    } finally {
      await this.subscriptions.releaseSeatLine({ id, token }).catch((error: unknown) => {
        // The lease runs out on its own; the next holder waits for it at most that long.
        logger.warn({ error, subscriptionId: id }, "seat line lease release failed");
      });
    }
  }

  /** A write that landed after a takeover: the next repair pass puts the line to the seat count. */
  private async recordLateWrite({ id, quantity }: { id: string; quantity: number }): Promise<void> {
    try {
      await this.subscriptions.recordSeatLineReconcile({ id });
      logger.warn(
        { subscriptionId: id, quantity },
        "seat line written after its lease was taken over; reconcile recorded for the repair pass",
      );
    } catch (error) {
      logger.error(
        { error, subscriptionId: id, quantity },
        "seat line written after its lease was taken over and the reconcile could not be recorded",
      );
    }
  }
}
