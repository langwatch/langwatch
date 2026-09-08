/**
 * Every entitlement procedure, declared once: the plan an organization is on,
 * what it has used against that plan, and what it has spent.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  entitlementOrganizationScopeSchema,
  projectSpendRollupSchema,
  sendUsageLimitWarningInputSchema,
  usageLimitWarningSchema,
} from "./entitlement.schemas.ts";
import { planSchema } from "./plan.ts";
import { usageStatsSchema } from "./usage.ts";

export const planTrpc = defineTrpcContract("plan")
  .query("getActivePlan")
  .withInput(entitlementOrganizationScopeSchema)
  .withOutput(planSchema)
  .build();

export const usageLimitsTrpc = defineTrpcContract("limits")
  .query("getUsage")
  .withInput(entitlementOrganizationScopeSchema)
  .withOutput(usageStatsSchema)

  .mutation("checkAndSendUsageLimitNotification")
  .withInput(sendUsageLimitWarningInputSchema)
  .withOutput(usageLimitWarningSchema)
  .build();

/** The window the billing screen asks its rollup over. */
export const aggregatedCostsInputSchema = z.object({
  organizationId: z.string(),
  startDate: z.number(),
  endDate: z.number(),
});

export const organizationSpendTrpc = defineTrpcContract("costs")
  .query("getAggregatedCostsForOrganization")
  .withInput(aggregatedCostsInputSchema)
  .withOutput(projectSpendRollupSchema.array())
  .build();
