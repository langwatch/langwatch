import { z } from "zod";
import type { PlanLimits } from "./limits.ts";
import type { MoneyByCurrency } from "./plan-type.ts";
import { moneyByCurrencySchema } from "./plan-type.ts";
import type { Plan } from "./plan.ts";

// The flat field names a resolved plan is quoted under. The catalogue states a
// limit as a value with its unit; the entitlement contract, the billing preset
// and every screen that shows a ceiling read it as `maxMembers` and friends.
// Both namings are plan facts, so both are stated here and nowhere else.

/** The seat and volume ceilings, and whether the plan may publish. */
export const planSeatsAndVolumeShape = {
  maxMembers: z.number(),
  maxMembersLite: z.number(),
  maxMessagesPerMonth: z.number(),
  canPublish: z.boolean(),
} as const;

/** The two dispatch ceilings an automation is settled against. */
export const planDispatchCeilingsShape = {
  maxTriggerPersistDispatchesPerDay: z.number().optional(),
  automationDailyDispatchCeiling: z.number().optional(),
} as const;

/** What the plan costs: per seat, per metered trace, and per period. */
export const planPricesShape = {
  userPrice: moneyByCurrencySchema.optional(),
  tracesPrice: moneyByCurrencySchema.optional(),
  prices: moneyByCurrencySchema,
} as const;

/** The ceilings a self-serve next step quotes, all of them required. */
export const planNextStepCeilingsShape = {
  maxMessagesPerMonth: z.number().int().positive(),
  maxMembers: z.number().int().positive(),
  /** Confirmed matches a day one automation may act on, on this rung. */
  automationDailyDispatchCeiling: z.number().int().positive(),
} as const;

export type PlanSeatsAndVolume = {
  maxMembers: number;
  maxMembersLite: number;
  maxMessagesPerMonth: number;
};

export type QuotedPlanLimits = PlanSeatsAndVolume & { canPublish: boolean };

export type PlanNextStepCeilings = {
  maxMessagesPerMonth: number;
  maxMembers: number;
  automationDailyDispatchCeiling: number;
};

/** The seat and volume ceilings, stated from parts. */
export function planSeatsAndVolume({
  members,
  membersLite,
  messagesPerMonth,
}: {
  members: number;
  membersLite: number;
  messagesPerMonth: number;
}): PlanSeatsAndVolume {
  return {
    maxMembers: members,
    maxMembersLite: membersLite,
    maxMessagesPerMonth: messagesPerMonth,
  };
}

/**
 * The seat count and metered volume, stated from parts. Generic in both,
 * because a subscription row carries them as nullable and a plan does not.
 */
export function planQuantities<Members, Volume>({
  members,
  messagesPerMonth,
}: {
  members: Members;
  messagesPerMonth: Volume;
}): { maxMembers: Members; maxMessagesPerMonth: Volume } {
  return { maxMembers: members, maxMessagesPerMonth: messagesPerMonth };
}

/** The ceilings and the publishing entitlement, stated from parts. */
export function quotedPlanLimits({
  members,
  membersLite,
  messagesPerMonth,
  publish,
}: {
  members: number;
  membersLite: number;
  messagesPerMonth: number;
  publish: boolean;
}): QuotedPlanLimits {
  return {
    ...planSeatsAndVolume({ members, membersLite, messagesPerMonth }),
    canPublish: publish,
  };
}

/** The seat count and metered volume `source` already carries. */
export function planQuantitiesOf<Members, Volume>(source: {
  maxMembers: Members;
  maxMessagesPerMonth: Volume;
}): { maxMembers: Members; maxMessagesPerMonth: Volume } {
  return planQuantities({
    members: source.maxMembers,
    messagesPerMonth: source.maxMessagesPerMonth,
  });
}

/** The ceilings and publishing entitlement `source` already carries. */
export function quotedPlanLimitsOf(source: QuotedPlanLimits): QuotedPlanLimits {
  return quotedPlanLimits({
    members: source.maxMembers,
    membersLite: source.maxMembersLite,
    messagesPerMonth: source.maxMessagesPerMonth,
    publish: source.canPublish,
  });
}

/** The ceilings a next step quotes, read off the rung it names. */
export function planNextStepCeilingsOf(source: PlanNextStepCeilings): PlanNextStepCeilings {
  return {
    maxMessagesPerMonth: source.maxMessagesPerMonth,
    maxMembers: source.maxMembers,
    automationDailyDispatchCeiling: source.automationDailyDispatchCeiling,
  };
}

/**
 * A catalogue plan's limits, under the names the resolved plan is quoted with.
 * Optional keys stay absent rather than present-and-undefined, because a plan
 * that says nothing about publishing entitlements is not a plan that says no.
 */
export function quotedLimitsOfPlan(plan: Plan): QuotedPlanLimits & {
  visibilityDays?: number;
  automationDailyDispatchCeiling: number;
  webhookEndpointsEnabled?: boolean;
  userPrice?: MoneyByCurrency;
  prices: MoneyByCurrency;
} {
  const limits: PlanLimits = plan.limits;

  return {
    ...(limits.visibility === null ? {} : { visibilityDays: limits.visibility.value }),
    ...planSeatsAndVolume({
      members: limits.members.value,
      membersLite: limits.membersLite.value,
      messagesPerMonth: limits.volume.value,
    }),
    canPublish: plan.gates.canPublish,
    automationDailyDispatchCeiling: limits.automationDailyDispatch.value,
    ...(plan.gates.webhookEndpoints ? { webhookEndpointsEnabled: true } : {}),
    ...(plan.pricing.seatPrice === null ? {} : { userPrice: plan.pricing.seatPrice }),
    prices: plan.pricing.prices,
  };
}
