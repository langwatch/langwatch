import { z } from "zod";

export const planSourceSchema = z.enum(["license", "subscription", "free"]);

export const moneyByCurrencySchema = z.object({
  USD: z.number(),
  EUR: z.number(),
});

export const planSchema = z.object({
  planSource: planSourceSchema,
  type: z.string(),
  name: z.string(),
  free: z.boolean(),
  visibilityDays: z.number().nullable().optional(),
  trialDays: z.number().optional(),
  daysSinceCreation: z.number().optional(),
  overrideAddingLimitations: z.boolean().optional(),
  maxMembers: z.number(),
  maxMembersLite: z.number(),
  maxMessagesPerMonth: z.number(),
  canPublish: z.boolean(),
  webhookEndpointsEnabled: z.boolean().optional(),
  maxTriggerPersistDispatchesPerDay: z.number().optional(),
  usageUnit: z.string().optional(),
  userPrice: moneyByCurrencySchema.optional(),
  tracesPrice: moneyByCurrencySchema.optional(),
  prices: moneyByCurrencySchema,
});

export type PlanSource = z.infer<typeof planSourceSchema>;
export type MoneyByCurrency = z.infer<typeof moneyByCurrencySchema>;
export type Plan = z.infer<typeof planSchema>;

/** Compatibility name while existing consumers migrate to `Plan`. */
export type PlanInfo = Plan;
