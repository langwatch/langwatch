import { z } from "zod";

/**
 * Where organization can go next: price for public ladder, people for negotiated
 * terms. Absent (not a fallback) if neither applies.
 */

/**
 * Organization buys from public ladder: plan and price (URL built specifically,
 * not generic pricing page).
 */
export const selfServeStepFields = {
  kind: z.literal("self_serve"),
  name: z.string().min(1).describe("The plan as a customer sees it named"),
  url: z.url().describe("Where this exact plan is bought"),
  price: z.number().nonnegative().describe("The whole amount charged per billing period"),
  currency: z.string().min(1),
  billingPeriod: z.enum(["monthly", "annual"]),
  pricedPerSeat: z.boolean().optional(),
} as const;

/** "$199 a month", "$2,199 a year", "$32 per person a month". */
export const priceLine = ({
  price,
  currency,
  billingPeriod,
  pricedPerSeat,
}: {
  price: number;
  currency: string;
  billingPeriod: "monthly" | "annual";
  pricedPerSeat?: boolean;
}): string =>
  `${formatMonthlyPrice({ monthlyPrice: price, currency })}${pricedPerSeat ? " per person" : ""} ${billingPeriod === "annual" ? "a year" : "a month"}`;

/**
 * The organization is on bespoke terms. No plan, no price, no ceiling: the
 * only honest next step is the people who can change what it already has.
 */
export const accountTeamStepSchema = z.object({
  kind: z.literal("account_team"),
  contactUrl: z.url(),
});

/** What the organization's volume is counted in, as its own meter reports it. */
export const usageUnitSchema = z.enum(["traces", "events"]);

export type UsageUnit = z.infer<typeof usageUnitSchema>;

/**
 * The noun a reader is metered in. "Messages" is what every one of these
 * mails said before the meter had two settings, and stays the default when
 * a sender reports none — inventing a unit we never asked about risks the wrong word.
 */
export const meteredNoun = (usageUnit: UsageUnit | undefined): string => usageUnit ?? "messages";

/** The same noun for one of them. */
export const meteredNounSingular = (usageUnit: UsageUnit | undefined): string =>
  meteredNoun(usageUnit).replace(/s$/, "");

/** A whole amount, in the currency the sender quoted it in. */
export const formatMonthlyPrice = ({
  monthlyPrice,
  currency,
}: {
  monthlyPrice: number;
  currency: string;
}): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(monthlyPrice) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(monthlyPrice);
