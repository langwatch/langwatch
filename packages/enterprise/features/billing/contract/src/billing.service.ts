import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import type { BillingPlanProvider } from "./billing-types";

export const BILLING_FEATURE_ID = "billing" as const;

export abstract class BillingService implements BillingPlanProvider {
  abstract getActivePlan(
    organizationId: string,
    user?: {
      id?: string;
      email?: string | null;
      name?: string | null;
      impersonator?: { email?: string | null };
    },
  ): Promise<PlanInfo>;
}
