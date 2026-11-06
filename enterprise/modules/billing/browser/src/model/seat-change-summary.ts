/**
 * What the Manage seats drawer says about a seat count change on a Growth plan: added seats
 * are charged now, prorated; lowered seats stay until the period paid for ends.
 * @see specs/licensing/seat-rotation.feature
 */
import { format, Temporal } from "@langwatch/time";
import { z } from "zod";

/** The seat quote the contract answers as the provider's own shape, checked where it is read. */
export const seatQuoteSchema = z.object({
  amountDueCents: z.number(),
  formattedAmountDue: z.string(),
  formattedCreditApplied: z.string().nullable(),
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

export type SeatSummaryRow = { label: string; value: string; muted?: boolean };

export type SeatChangeSummary = {
  note: string | undefined;
  rows: SeatSummaryRow[];
  actionLabel: string;
};

/** The button that commits the change: "Lower to 3 seats", "Add 1 seat", "Add 2 seats". */
export function seatChangeActionLabel({ from, to }: { from: number; to: number }): string {
  if (to < from) return `Lower to ${to} seats`;
  const added = to - from;
  return `Add ${added} seat${added === 1 ? "" : "s"}`;
}

export function seatChangeSummary({
  from,
  to,
  quote,
}: {
  from: number;
  to: number;
  /** Absent while the quote loads: the rows say what they can without prices. */
  quote: SeatQuote | undefined;
}): SeatChangeSummary {
  const seatsRow: SeatSummaryRow = { label: "Seats", value: `${from} → ${to}` };
  const actionLabel = seatChangeActionLabel({ from, to });
  if (!quote) return { note: undefined, rows: [seatsRow], actionLabel };

  const suffix = periodSuffixOf(quote.billingInterval);
  const newPrice = `${quote.formattedRecurringTotal}${suffix}`;

  if (quote.appliesAt != null) {
    const day = billingDay(quote.appliesAt);
    const kept = quote.keptSeats ?? from;
    const rest = quote.billingInterval === "year" ? "year" : "month";
    const rows: SeatSummaryRow[] = [seatsRow, { label: `From ${day}`, value: newPrice }];
    if (quote.formattedKeptRecurringTotal) {
      rows.push({
        label: `Until ${day}`,
        value: `${quote.formattedKeptRecurringTotal}${suffix}`,
        muted: true,
      });
    }
    const note =
      to < from
        ? `You'll keep ${kept} seats until ${day}, then pay for ${to}. No refund for the rest of this ${rest}.`
        : `Nothing to pay today: you keep ${kept} seats until ${day}, then pay for ${to}.`;
    return {
      note,
      rows,
      actionLabel,
    };
  }

  return {
    note: `${quote.formattedAmountDue} today for the rest of this billing period, then ${newPrice}.`,
    rows: [seatsRow, { label: "From today", value: newPrice }],
    actionLabel,
  };
}
