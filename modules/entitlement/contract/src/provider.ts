import { z } from "zod";
import type { Plan } from "./plan.ts";

export const planProviderUserSchema = z.object({
  id: z.string().optional(),
  email: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  impersonator: z
    .object({
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

/** A provider-specific source. `null` means that source has no active grant. */
export interface EntitlementSource {
  resolve(input: ResolvePlanInput): Promise<Plan | null>;
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
