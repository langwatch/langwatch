import { z } from "zod";
import type { Plan } from "./plan";

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

export const resolvePlanInputSchema = z.object({
  organizationId: z.string(),
  user: planProviderUserSchema.optional(),
});

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
  resolve(
    user: PlanProviderUser | undefined,
  ): Pick<Plan, "overrideAddingLimitations">;
}
