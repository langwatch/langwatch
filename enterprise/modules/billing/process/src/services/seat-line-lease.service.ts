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
 * Wraps every Stripe write. Before it, one step renews the lease and records the write; refused,
 * Stripe is never called. After it, the record is cleared only while the lease is still held, so a
 * lost lease, a crash or a database outage leaves it for the seat line repair to settle.
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
      | "claimSeatLine"
      | "renewSeatLine"
      | "releaseSeatLine"
      | "beginSeatLineWrite"
      | "finishSeatLineWrite"
    >,
  ) {}

  static create({
    subscriptions,
  }: {
    subscriptions: Pick<
      SeatEventSubscriptionRepository,
      | "claimSeatLine"
      | "renewSeatLine"
      | "releaseSeatLine"
      | "beginSeatLineWrite"
      | "finishSeatLineWrite"
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
    // Stripe has no conditional update: a write that stalls past the lease can still land after
    // a takeover. SEAT_LINE_WRITE_TIMEOUT_MS bounds that, and the record written ahead of every
    // write stays until the repair pass settles it against the newer holder's seat count.
    const guard: SeatLineGuard = {
      write: async ({ quantity, send }) => {
        const start = await this.subscriptions.beginSeatLineWrite({
          id,
          token,
          leaseMs: SEAT_LINE_LEASE_MS,
          quantity,
        });
        if (!start.held) throw new SeatLineLeaseLostError();
        const sent = await send();
        const held = start.opened
          ? await this.subscriptions.finishSeatLineWrite({ id, token, opened: start.opened })
          : await this.subscriptions.renewSeatLine({ id, token, leaseMs: SEAT_LINE_LEASE_MS });
        if (!held) throw new SeatLineLeaseLostError();
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
}
