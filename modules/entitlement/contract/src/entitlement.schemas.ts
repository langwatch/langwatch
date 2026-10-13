import type { Named } from "@langwatch/module";
/**
 * What the entitlement capability is asked, and what it answers, beyond the
 * plan itself: the usage reading for one operator, the approaching-limit
 * warning, and an organization's spend rolled up per project.
 */
import { z } from "zod";

import { entitlementOperatorSchema, planProviderUserSchema } from "./provider.ts";

/** The tenant every entitlement door is asked about. */
const entitlementOrganizationScopeSchemaDefinition = z.object({ organizationId: z.string() });
export interface EntitlementOrganizationScopeSchema extends Named<
  typeof entitlementOrganizationScopeSchemaDefinition
> {}
export const entitlementOrganizationScopeSchema: EntitlementOrganizationScopeSchema =
  entitlementOrganizationScopeSchemaDefinition;

/**
 * One organization's usage reading. `user` is the operator the plan is
 * resolved for; `operator` is the same person named by identifier alone, which
 * is all a request carries before the app looks them up.
 */
const getUsageInputSchemaDefinition = z.object({
  organizationId: z.string(),
  user: planProviderUserSchema.optional(),
  operator: entitlementOperatorSchema.optional(),
});
export interface GetUsageInputSchema extends Named<typeof getUsageInputSchemaDefinition> {}
export const getUsageInputSchema: GetUsageInputSchema = getUsageInputSchemaDefinition;
export type GetUsageInput = z.infer<typeof getUsageInputSchema>;

/** The reading the approaching-limit warning is judged against. */
const sendUsageLimitWarningInputSchemaDefinition = z.object({
  organizationId: z.string(),
  currentMonthMessagesCount: z.number(),
  maxMonthlyUsageLimit: z.number(),
});
export interface SendUsageLimitWarningInputSchema extends Named<
  typeof sendUsageLimitWarningInputSchemaDefinition
> {}
export const sendUsageLimitWarningInputSchema: SendUsageLimitWarningInputSchema =
  sendUsageLimitWarningInputSchemaDefinition;
export type SendUsageLimitWarningInput = z.infer<typeof sendUsageLimitWarningInputSchema>;

/** Whether the warning went out, and the row it was written down as. */
const usageLimitWarningSchemaDefinition = z
  .object({
    sent: z.boolean(),
    notificationId: z.string().optional(),
    sentAt: z.date().nullable().optional(),
  })
  .strict();
export interface UsageLimitWarningSchema extends Named<typeof usageLimitWarningSchemaDefinition> {}
export const usageLimitWarningSchema: UsageLimitWarningSchema = usageLimitWarningSchemaDefinition;
export type UsageLimitWarning = z.infer<typeof usageLimitWarningSchema>;

/** The window an organization's spend is rolled up over, for one caller. */
const listOrganizationSpendInputSchemaDefinition = z.object({
  organizationId: z.string(),
  /** Narrows the rollup to the projects this person can reach. */
  userId: z.string(),
  startDate: z.number(),
  endDate: z.number(),
});
export interface ListOrganizationSpendInputSchema extends Named<
  typeof listOrganizationSpendInputSchemaDefinition
> {}
export const listOrganizationSpendInputSchema: ListOrganizationSpendInputSchema =
  listOrganizationSpendInputSchemaDefinition;
export type ListOrganizationSpendInput = z.infer<typeof listOrganizationSpendInputSchema>;

/** The project a spend rollup is for: its identity only, never its credentials. */
const projectSpendRollupProjectSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  teamId: z.string(),
});
export interface ProjectSpendRollupProjectSchema extends Named<
  typeof projectSpendRollupProjectSchemaDefinition
> {}
export const projectSpendRollupProjectSchema: ProjectSpendRollupProjectSchema =
  projectSpendRollupProjectSchemaDefinition;
export type ProjectSpendRollupProject = z.infer<typeof projectSpendRollupProjectSchema>;

/** One project's spend, as the billing screen groups it; cost rows keep the grouped shape. */
const projectSpendRollupSchemaDefinition = z.object({
  project: projectSpendRollupProjectSchema,
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
export interface ProjectSpendRollupSchema extends Named<
  typeof projectSpendRollupSchemaDefinition
> {}
export const projectSpendRollupSchema: ProjectSpendRollupSchema =
  projectSpendRollupSchemaDefinition;
export type ProjectSpendRollup = z.infer<typeof projectSpendRollupSchema>;
