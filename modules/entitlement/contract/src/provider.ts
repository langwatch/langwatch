import { z } from "zod";

import { planSchema, type Plan } from "./plan.ts";

export const planProviderUserSchema = z.object({
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

/**
 * The operator behind a request, as a door knows them: identifiers only. The
 * plan sources read an email, and looking one up is the app's work, not a
 * transport's.
 */
export const entitlementOperatorSchema = z.object({
  id: z.string(),
  /** Set when a platform operator is acting as this person. */
  impersonatorId: z.string().optional(),
});

export const resolvePlanInputSchema = z.object({
  organizationId: z.string(),
  user: planProviderUserSchema.optional(),
  /** Resolved into `user` before any source sees it. */
  operator: entitlementOperatorSchema.optional(),
});

export type EntitlementOperator = z.infer<typeof entitlementOperatorSchema>;
export type PlanProviderUser = z.infer<typeof planProviderUserSchema>;
export type ResolvePlanInput = z.infer<typeof resolvePlanInputSchema>;

export interface PlanProvider {
  getActivePlan(input: ResolvePlanInput): Promise<Plan>;
}

/** What one provider-specific source answers: the plan it grants, or no grant at all. */
export const entitlementGrantSchema = z.discriminatedUnion("granted", [
  z.object({ granted: z.literal(true), plan: planSchema }),
  z.object({ granted: z.literal(false) }),
]);
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
