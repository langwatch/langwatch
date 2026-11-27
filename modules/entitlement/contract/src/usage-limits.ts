import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The fixed code of each limit a plan can set; a code, never copy. */
export const planUsageLimitNameSchema = z.enum([
  "traces_per_month",
  "events_per_month",
  "members",
  "members_lite",
  "members_developer",
  "scenarios",
  "scenario_suites",
  "evaluators",
]);
export type PlanUsageLimitName = z.infer<typeof planUsageLimitNameSchema>;

/**
 * One limit: `cap` null is uncapped. `used` null is a count entitlement does not hold (the
 * creation caps, which their owning modules count) or a counting store that could not answer.
 */
const planUsageLimitSchemaDefinition = z
  .object({
    name: planUsageLimitNameSchema,
    cap: z.number().int().nonnegative().nullable(),
    used: z.number().int().nonnegative().nullable(),
  })
  .strict();
export interface PlanUsageLimitSchema extends Named<typeof planUsageLimitSchemaDefinition> {}
export const planUsageLimitSchema: PlanUsageLimitSchema = planUsageLimitSchemaDefinition;
export type PlanUsageLimit = z.infer<typeof planUsageLimitSchema>;

/** An organization's plan code and its limits, for a staff investigation (ADR-202). */
const organizationUsageLimitsSchemaDefinition = z
  .object({ plan: z.string(), limits: z.array(planUsageLimitSchema) })
  .strict();
export interface OrganizationUsageLimitsSchema extends Named<
  typeof organizationUsageLimitsSchemaDefinition
> {}
export const organizationUsageLimitsSchema: OrganizationUsageLimitsSchema =
  organizationUsageLimitsSchemaDefinition;
export type OrganizationUsageLimits = z.infer<typeof organizationUsageLimitsSchema>;
