/**
 * What the entitlement capability is asked, and what it answers, beyond the
 * plan itself: the usage reading for one operator, the approaching-limit
 * warning, and an organization's spend rolled up per project.
 */
import { z } from "zod";
import { entitlementOperatorSchema, planProviderUserSchema } from "./provider.ts";

/** The tenant every entitlement door is asked about. */
export const entitlementOrganizationScopeSchema = z.object({ organizationId: z.string() });

/**
 * One organization's usage reading. `user` is the operator the plan is
 * resolved for; `operator` is the same person named by identifier alone, which
 * is all a request carries before the app looks them up.
 */
export const getUsageInputSchema = z.object({
  organizationId: z.string(),
  user: planProviderUserSchema.optional(),
  operator: entitlementOperatorSchema.optional(),
});
export type GetUsageInput = z.infer<typeof getUsageInputSchema>;

/** The reading the approaching-limit warning is judged against. */
export const sendUsageLimitWarningInputSchema = z.object({
  organizationId: z.string(),
  currentMonthMessagesCount: z.number(),
  maxMonthlyUsageLimit: z.number(),
});
export type SendUsageLimitWarningInput = z.infer<typeof sendUsageLimitWarningInputSchema>;

/** Whether the warning went out, and the row it was written down as. */
export const usageLimitWarningSchema = z
  .object({
    sent: z.boolean(),
    notificationId: z.string().optional(),
    sentAt: z.date().nullable().optional(),
  })
  .strict();
export type UsageLimitWarning = z.infer<typeof usageLimitWarningSchema>;

/** The window an organization's spend is rolled up over, for one caller. */
export const listOrganizationSpendInputSchema = z.object({
  organizationId: z.string(),
  /** Narrows the rollup to the projects this person can reach. */
  userId: z.string(),
  startDate: z.number(),
  endDate: z.number(),
});
export type ListOrganizationSpendInput = z.infer<typeof listOrganizationSpendInputSchema>;

/**
 * One project's spend, as the billing screen groups it. Loose on purpose: the
 * project row and the grouped cost rows travel as the operational database
 * shaped them, and narrowing them here would drop columns the screen reads.
 */
export const projectSpendRollupSchema = z.object({
  project: z.looseObject({ id: z.string() }),
  costs: z.array(
    z.looseObject({
      projectId: z.string(),
      costType: z.string(),
      currency: z.string(),
      _sum: z.object({ amount: z.number().nullable() }),
      _count: z.object({ id: z.number() }),
    }),
  ),
});
export type ProjectSpendRollup = z.infer<typeof projectSpendRollupSchema>;
