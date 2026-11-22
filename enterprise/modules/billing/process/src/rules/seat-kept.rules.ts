// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Growth seats are added now, prorated, and lowered from the next billing cycle: the seats
 * paid for stay usable until the period ends. These rules hold that arithmetic; no provider
 * call and no database read happens here. specs/licensing/seat-rotation.feature.
 */
import type { Instant } from "@langwatch/time";

/** Seats paid for this period that a decrease left usable, and until when. */
export type KeptSeats = { seats: number; until: Instant };

/** The seats kept and still in force at `now`; zero once the period they were paid for ended. */
export const seatsKeptAt = ({
  seatsKept,
  seatsKeptUntil,
  now,
}: {
  seatsKept: number | null;
  seatsKeptUntil: Instant | null;
  now: Instant;
}): number => {
  if (seatsKept === null || seatsKeptUntil === null) return 0;
  return seatsKeptUntil.epochMilliseconds > now.epochMilliseconds ? seatsKept : 0;
};

/** The seats a plan grants: the seats billed, or the seats kept while they last. */
export const effectiveMaxMembers = ({
  maxMembers,
  seatsKept,
  seatsKeptUntil,
  now,
}: {
  maxMembers: number;
  seatsKept: number | null;
  seatsKeptUntil: Instant | null;
  now: Instant;
}): number => Math.max(maxMembers, seatsKeptAt({ seatsKept, seatsKeptUntil, now }));

/** One quantity change sent to the provider, in the order they are sent. */
export type SeatChangeStep = { quantity: number; prorationBehavior: "always_invoice" | "none" };

/**
 * How a requested seat count reaches the provider. `chargedShare` is the part of the quantity
 * change invoiced now (an increase above seats already paid for this period); a decrease, or
 * a raise back within kept seats, charges nothing and applies from `appliesAt`.
 */
export type SeatChangePlan = {
  steps: SeatChangeStep[];
  kept: KeptSeats | null;
  /** Null when the change applies now; otherwise the instant the lower count starts billing. */
  appliesAt: Instant | null;
  /** The seats billed now that the charged step adds, over the seats it moves the line by. */
  chargedShare: { added: number; moved: number } | null;
};

export const planSeatChange = ({
  billed,
  keptSeats,
  keptUntil,
  requested,
  periodEnd,
}: {
  /** The quantity on the provider's seat line now. */
  billed: number;
  /** Kept seats still in force (see {@link seatsKeptAt}), and until when they were kept. */
  keptSeats: number;
  keptUntil: Instant | null;
  requested: number;
  /** End of the period already invoiced. */
  periodEnd: Instant;
}): SeatChangePlan => {
  const paidThisPeriod = Math.max(billed, keptSeats);

  if (requested > paidThisPeriod) {
    // Lift the line to what was paid for without proration, then charge only the rest.
    const lift: SeatChangeStep[] =
      paidThisPeriod > billed ? [{ quantity: paidThisPeriod, prorationBehavior: "none" }] : [];
    return {
      steps: [...lift, { quantity: requested, prorationBehavior: "always_invoice" }],
      kept: null,
      appliesAt: null,
      chargedShare:
        lift.length > 0 ? { added: requested - paidThisPeriod, moved: requested - billed } : null,
    };
  }

  if (requested === billed && keptSeats === 0) {
    return {
      steps: [{ quantity: requested, prorationBehavior: "always_invoice" }],
      kept: null,
      appliesAt: null,
      chargedShare: null,
    };
  }

  const until = keptSeats > 0 && keptUntil ? keptUntil : periodEnd;
  return {
    steps: [{ quantity: requested, prorationBehavior: "none" }],
    kept: requested < paidThisPeriod ? { seats: paidThisPeriod, until } : null,
    appliesAt: requested < paidThisPeriod ? until : null,
    chargedShare: null,
  };
};
