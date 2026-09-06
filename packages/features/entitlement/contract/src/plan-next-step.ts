import { z } from "zod";

/**
 * Where an organization can go next, when anything may be said about it at all.
 *
 * Three answers, and the reason there are three is that a plan name and a price
 * are only ever true of an organization buying from the public ladder. An
 * organization on legacy enterprise terms, on the newer enterprise pricing, or
 * on anything negotiated has an allowance and a price that are its own, so
 * quoting the list at it is wrong in a way the reader can see, and the honest
 * next step is the people who hold its contract.
 *
 * `none` is a real answer rather than a missing one: an organization already at
 * the top of the ladder it buys from has nowhere self-serve to go, and a caller
 * that says nothing is correct. Nothing here builds a link — a deployment's own
 * addresses belong to the process that knows them, not to a plan.
 */
export const planNextStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("self_serve"),
    /** The plan type, with an annual variant collapsed onto its monthly tier. */
    tier: z.string().min(1),
    /** The plan as a customer sees it named. */
    name: z.string().min(1),
    /** A whole monthly amount in `currency`, per seat when `pricedPerSeat`. */
    monthlyPrice: z.number().nonnegative(),
    currency: z.enum(["USD", "EUR"]),
    pricedPerSeat: z.boolean(),
    maxMessagesPerMonth: z.number().int().positive(),
    maxMembers: z.number().int().positive(),
    /** Confirmed matches a day one automation may act on, on this rung. */
    automationDailyDispatchCeiling: z.number().int().positive(),
  }),
  z.object({ kind: z.literal("account_team") }),
  z.object({ kind: z.literal("none") }),
]);

export type PlanNextStep = z.infer<typeof planNextStepSchema>;

/** The currencies a plan is quoted in. */
export type PlanCurrency = PlanNextStep extends { currency: infer C } ? C : never;

/**
 * Whether an organization's terms are its own rather than the public ladder's.
 *
 * A licence is negotiated by definition, and an override on the plan's own
 * limits is the record of somebody having agreed something different. Either
 * one means a number from the public page is not this organization's number,
 * so every hook that would show a price, a seat ceiling or a higher tier asks
 * this first and shows nothing rather than something false.
 */
export const isAccountManagedPlan = (
  plan: Readonly<{ planSource?: string; overrideAddingLimitations?: boolean }>,
): boolean => plan.planSource === "license" || plan.overrideAddingLimitations === true;
