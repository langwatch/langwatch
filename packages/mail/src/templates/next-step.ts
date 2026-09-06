import { z } from "zod";

/**
 * Where an organization can go next, as a message is allowed to say it.
 *
 * Three shapes, and the reason there are three is that a price is only ever
 * true of an organization buying from the public ladder. An organization on
 * legacy enterprise terms, on the newer enterprise pricing, or on anything
 * negotiated has limits and a price that are its own, so quoting the list
 * price at it is wrong in a way the reader can see. Those organizations get
 * the people who hold their contract instead.
 *
 * The absent case is deliberate and is not a fallback: a sender that cannot
 * say what comes next for THIS organization says nothing, because the guess
 * is what turns a service message into a mis-sell.
 */

/**
 * The organization buys from the public ladder, so a plan and a price are true
 * of it.
 *
 * `url` is the page that sells THIS plan — the checkout or the plan's own page,
 * built by the sender from what billing produced for it. A generic pricing page
 * would make the reader choose again a question they have already answered.
 *
 * Every field here is composed into copy and none of it is written in a
 * template: a plan whose price is a literal in a message is a price that is
 * wrong the day it changes and right nowhere but in a screenshot.
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
 * The noun a reader is metered in.
 *
 * "Messages" is what every one of these mails said before the meter had two
 * settings, and it stays the answer for a sender that does not report one:
 * inventing a unit for an organization whose meter we did not ask about would
 * put a number next to the wrong word.
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
