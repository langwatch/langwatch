// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A seat bought mid-period is billed on an invoice of its own, outside the subscription's
 * cycle, so an unpaid one never takes the period's metered usage with it. Its metadata names
 * the subscription whose seat line it raises once paid, and to how many seats.
 */

export const SEAT_INVOICE_SUBSCRIPTION_KEY = "langwatch_seat_subscription";
export const SEAT_INVOICE_SEATS_KEY = "langwatch_seats";

/** How long an unpaid seat invoice stays payable before billing voids it, as Stripe held updates. */
export const SEAT_INVOICE_LIFETIME_SECONDS = 23 * 60 * 60;

export type SeatInvoicePurpose = Readonly<{ subscriptionId: string; seats: number }>;

export function seatInvoiceMetadata(purpose: SeatInvoicePurpose): Record<string, string> {
  return {
    [SEAT_INVOICE_SUBSCRIPTION_KEY]: purpose.subscriptionId,
    [SEAT_INVOICE_SEATS_KEY]: String(purpose.seats),
  };
}

/** What an invoice's metadata says: the seat purchase it bills, or that it bills none. */
export type SeatInvoiceRead =
  | Readonly<{ seatInvoice: true; purpose: SeatInvoicePurpose }>
  | Readonly<{ seatInvoice: false }>;

export function readSeatInvoice(
  metadata: Readonly<Record<string, string | undefined>> | null | undefined,
): SeatInvoiceRead {
  const subscriptionId = metadata?.[SEAT_INVOICE_SUBSCRIPTION_KEY];
  const seats = Number(metadata?.[SEAT_INVOICE_SEATS_KEY]);
  if (!subscriptionId || !Number.isInteger(seats) || seats <= 0) return { seatInvoice: false };
  return { seatInvoice: true, purpose: { subscriptionId, seats } };
}

/** Whether an open seat invoice created at `created` (epoch seconds) is past its lifetime. */
export function isStaleSeatInvoice({ created, now }: { created: number; now: number }): boolean {
  return now - created >= SEAT_INVOICE_LIFETIME_SECONDS;
}
