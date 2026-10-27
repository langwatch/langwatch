import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type {
  BaselinePlanSource,
  EntitlementGrant,
  EntitlementSource,
  Plan,
  ResolvePlanInput,
} from "@langwatch/entitlement-contract";

/**
 * LangWatch Cloud's plan for an organization, read from billing's subscriptions: main's SaaS
 * plan provider. It is also the Cloud baseline, so a free plan keeps its subscription overrides.
 */
export class SubscriptionPlanService implements BaselinePlanSource {
  static create(billing: Pick<BillingApi, "getActiveSubscriptionPlan">): SubscriptionPlanService {
    return new SubscriptionPlanService(billing);
  }

  private constructor(private readonly billing: Pick<BillingApi, "getActiveSubscriptionPlan">) {}

  /** The plan itself, as the Cloud baseline reads it. */
  resolve(input: ResolvePlanInput): Promise<Plan> {
    return this.billing.getActiveSubscriptionPlan({
      organizationId: input.organizationId,
      user: input.user,
    });
  }

  /** The same plans as a paid source: Cloud always answers a plan, so it grants one. */
  asGrantSource(): EntitlementSource {
    return {
      resolve: async (input): Promise<EntitlementGrant> => ({
        granted: true,
        plan: await this.resolve(input),
      }),
    };
  }
}
