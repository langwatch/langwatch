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
 * stops unwritten; lost after, it reads the line back, reports a write that may have overwritten
 * the newer holder's, and stops.
 */
export type SeatLineGuard = {
  write: <R>(input: {
    quantity: number;
    send: () => Promise<R>;
    readQuantity: () => Promise<number | null | undefined>;
  }) => Promise<R>;
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
    const renew = () =>
      this.subscriptions.renewSeatLine({ id, token, leaseMs: SEAT_LINE_LEASE_MS });
    // Stripe has no conditional update: a write that stalls past the lease can still land after
    // a takeover. SEAT_LINE_WRITE_TIMEOUT_MS bounds that, and the check after it reports it.
    const guard: SeatLineGuard = {
      write: async ({ quantity, send, readQuantity }) => {
        if (!(await renew())) throw new SeatLineLeaseLostError();
        const sent = await send();
        if (!(await renew())) {
          await this.reportLateWrite({ id, quantity, readQuantity });
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

  /** A write that landed after a takeover: an error unless Stripe shows a newer write after it. */
  private async reportLateWrite({
    id,
    quantity,
    readQuantity,
  }: {
    id: string;
    quantity: number;
    readQuantity: () => Promise<number | null | undefined>;
  }): Promise<void> {
    const current = await readQuantity().catch(() => "unread" as const);
    if (current === "unread" || current === quantity) {
      logger.error(
        { subscriptionId: id, quantity },
        "seat line written after its lease was taken over and Stripe still shows that write; " +
          "the newer seat change may have been overwritten, check the seat line",
      );
      return;
    }
    logger.warn(
      { subscriptionId: id, quantity, current },
      "seat line written after its lease was taken over; a newer write followed it",
    );
  }
}
