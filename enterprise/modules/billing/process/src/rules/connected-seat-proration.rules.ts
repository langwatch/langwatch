// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a mid-term seat change of a connected self-hosted customer owes
 * (ADR-156 section 7).
 *
 * The amount is worked out per seat first and only then multiplied, so the
 * unit amount and the quantity on the invoice line multiply back to the total
 * a customer reads. Seats that went down are not credited back.
 */

import type { Instant } from "@langwatch/time";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `from` to `to`, floored, negative when `to` comes first. */
export function daysBetween(from: Instant, to: Instant): number {
  return Math.floor((to.epochMilliseconds - from.epochMilliseconds) / MS_PER_DAY);
}

/**
 * What one added seat costs for the rest of the term, in cents.
 *
 * Only the part of the term still to run is charged, counted from the day the
 * seats changed. Rounded to the cent per seat, because that is the unit amount
 * the invoice line carries.
 */
export function proratedSeatUnitAmountCents({
  seatRateCents,
  daysRemaining,
  termDays,
}: {
  seatRateCents: number;
  daysRemaining: number;
  termDays: number;
}): number {
  if (daysRemaining <= 0 || termDays <= 0) return 0;

  return Math.round((seatRateCents * daysRemaining) / termDays);
}

/** The line a customer reads on the invoice. */
export function seatInvoiceDescription({
  addedSeats,
  changedAt,
  daysRemaining,
  termDays,
}: {
  addedSeats: number;
  changedAt: Instant;
  daysRemaining: number;
  termDays: number;
}): string {
  const day = changedAt.toString().slice(0, 10);
  const seats = addedSeats === 1 ? "seat" : "seats";

  return (
    `${addedSeats} ${seats} added on ${day}, ` +
    `charged for the ${daysRemaining} days of the ${termDays} day term that remain`
  );
}
