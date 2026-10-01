import { planNextStepCeilingsShape } from "@langwatch/plans";
import { z } from "zod";

/**
 * Where an organization can upgrade next. Three answers: self_serve (public ladder),
 * account_team (negotiated), none (already at top).
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
    ...planNextStepCeilingsShape,
  }),
  z.object({ kind: z.literal("account_team") }),
  z.object({ kind: z.literal("none") }),
]);

export type PlanNextStep = z.infer<typeof planNextStepSchema>;

/** The currencies a plan is quoted in. */
export type PlanCurrency = PlanNextStep extends { currency: infer C } ? C : never;

/**
 * Checks if an organization's terms are negotiated (licensed or overridden),
 * not from the public ladder.
 */
export const isAccountManagedPlan = (
  plan: Readonly<{ planSource?: string; overrideAddingLimitations?: boolean }>,
): boolean => plan.planSource === "license" || plan.overrideAddingLimitations === true;
