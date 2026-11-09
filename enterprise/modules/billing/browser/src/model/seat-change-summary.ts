/**
 * The seat quote as the provider answers it, the billed seats while lowered seats are kept,
 * and how a billing day is printed.
 * @see specs/licensing/seat-rotation.feature
 */
import { format, Temporal } from "@langwatch/time";
import { z } from "zod";

/** The seat quote the contract answers as the provider's own shape, checked where it is read. */
export const seatQuoteSchema = z.object({
  amountDueCents: z.number(),
  formattedAmountDue: z.string(),
  formattedCreditApplied: z.string().nullable(),
  /** Of `amountDueCents`, the tax; absent or zero when none is charged. */
  taxCents: z.number().optional(),
  formattedAmountDueExcludingTax: z.string().nullable().optional(),
  formattedTax: z.string().nullable().optional(),
  /** Seats times the seat price, before any tax. */
  formattedRecurringTotal: z.string(),
  billingInterval: z.string(),
  quotedAt: z.number(),
  appliesAt: z.number().nullable().optional(),
  keptSeats: z.number().nullable().optional(),
  formattedKeptRecurringTotal: z.string().nullable().optional(),
});

export type SeatQuote = z.infer<typeof seatQuoteSchema>;

export function seatQuoteOf(data: unknown): SeatQuote | undefined {
  const parsed = seatQuoteSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

/** "€20.72 + €4.35 VAT" under a quoted charge with VAT; undefined when it has none. */
export function quoteVatSplit(quote: SeatQuote): string | undefined {
  if (!quote.formattedAmountDueExcludingTax || !quote.formattedTax) return undefined;
  return `${quote.formattedAmountDueExcludingTax} + ${quote.formattedTax} VAT`;
}

/** A billing day as the drawer prints it, "1 Dec"; periods turn over at midnight UTC. */
export function billingDay(epochMilliseconds: number): string {
  return format(epochMilliseconds, "d MMM", { timeZone: "UTC" });
}

/** "/mo" or "/yr" after a recurring price; nothing for a period it does not know. */
export function periodSuffixOf(interval: string): string {
  if (interval === "year") return "/yr";
  if (interval === "month") return "/mo";
  return "";
}

/** The subscription row as `subscription.getLastSubscription` answers it, checked here. */
const seatBillingSchema = z.object({
  maxMembers: z.number().nullable(),
  seatsKept: z.number().nullable().optional(),
  seatsKeptUntil: z.string().datetime({ offset: true }).nullable().optional(),
});

/**
 * The seats the provider bills while a lowered count still keeps more seats usable, so the
 * drawer starts from what is paid for; undefined when no kept seats are in force.
 */
export function billedSeatsWhileKept({
  subscription,
  nowMs,
}: {
  subscription: unknown;
  nowMs: number;
}): number | undefined {
  const parsed = seatBillingSchema.safeParse(subscription);
  if (!parsed.success) return undefined;
  const { maxMembers, seatsKept, seatsKeptUntil } = parsed.data;
  if (maxMembers == null || seatsKept == null || !seatsKeptUntil) return undefined;
  const inForce =
    Temporal.Instant.from(seatsKeptUntil).epochMilliseconds > nowMs && seatsKept > maxMembers;
  return inForce ? maxMembers : undefined;
}
