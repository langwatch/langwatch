import type { Named } from "@langwatch/module";
import { z } from "zod";

import { planSchema, type Plan } from "./plan.ts";

const planProviderUserSchemaDefinition = z.object({
  id: z.string().optional(),
  email: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  impersonator: z
    .object({
      id: z.string().optional(),
      email: z.string().nullable().optional(),
    })
    .optional(),
});
export interface PlanProviderUserSchema extends Named<typeof planProviderUserSchemaDefinition> {}
export const planProviderUserSchema: PlanProviderUserSchema = planProviderUserSchemaDefinition;

/**
 * The operator behind a request, as a door knows them: identifiers only. The
 * subscription source decides any override from the impersonator's id.
 */
const entitlementOperatorSchemaDefinition = z.object({
  id: z.string(),
  /** Set when a platform operator is acting as this person. */
  impersonatorId: z.string().optional(),
});
export interface EntitlementOperatorSchema extends Named<
  typeof entitlementOperatorSchemaDefinition
> {}
export const entitlementOperatorSchema: EntitlementOperatorSchema =
  entitlementOperatorSchemaDefinition;

const resolvePlanInputSchemaDefinition = z.object({
  organizationId: z.string(),
  user: planProviderUserSchema.optional(),
  /** Resolved into `user` before any source sees it. */
  operator: entitlementOperatorSchema.optional(),
});
export interface ResolvePlanInputSchema extends Named<typeof resolvePlanInputSchemaDefinition> {}
export const resolvePlanInputSchema: ResolvePlanInputSchema = resolvePlanInputSchemaDefinition;

export type EntitlementOperator = z.infer<typeof entitlementOperatorSchema>;
export type PlanProviderUser = z.infer<typeof planProviderUserSchema>;
export type ResolvePlanInput = z.infer<typeof resolvePlanInputSchema>;

export interface PlanProvider {
  getActivePlan(input: ResolvePlanInput): Promise<Plan>;
}

/** What one provider-specific source answers: the plan it grants, or no grant at all. */
const entitlementGrantSchemaDefinition = z.discriminatedUnion("granted", [
  z.object({ granted: z.literal(true), plan: planSchema }),
  z.object({ granted: z.literal(false) }),
]);
export interface EntitlementGrantSchema extends Named<typeof entitlementGrantSchemaDefinition> {}
export const entitlementGrantSchema: EntitlementGrantSchema = entitlementGrantSchemaDefinition;
export type EntitlementGrant = z.infer<typeof entitlementGrantSchema>;

/** A provider-specific source of an organization's plan. */
export interface EntitlementSource {
  resolve(input: ResolvePlanInput): Promise<EntitlementGrant>;
}

export interface BaselinePlanSource {
  resolve(input: ResolvePlanInput): Plan | Promise<Plan>;
}

export interface PlanEnricher {
  enrich(plan: Plan, input: ResolvePlanInput): Plan | Promise<Plan>;
}

export interface AuthorizationContextResolver {
  resolve(user: PlanProviderUser | undefined): Pick<Plan, "overrideAddingLimitations">;
}
