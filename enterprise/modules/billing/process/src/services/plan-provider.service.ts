import {
  BillingService,
  getFreePlanLimits,
  PLAN_LIMITS,
  type PlanTypes,
} from "@langwatch/enterprise-billing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";

import type { BillingSubscriptionRepository } from "../repositories/subscription.repository.ts";

// Fields that exist on both PlanInfo (as number) and Subscription (as Int?)
type NumericOverrideField = "maxMembers" | "maxMembersLite" | "maxMessagesPerMonth";

export const NUMERIC_OVERRIDE_FIELDS: NumericOverrideField[] = [
  "maxMembers",
  "maxMembersLite",
  "maxMessagesPerMonth",
];

export class SaaSPlanProviderService extends BillingService {
  private constructor(
    private readonly subscriptions: BillingSubscriptionRepository,
    private readonly isSaas: boolean,
  ) {
    super();
  }

  static create(options: {
    subscriptions: BillingSubscriptionRepository;
    isSaas: boolean;
  }): SaaSPlanProviderService {
    return new SaaSPlanProviderService(options.subscriptions, options.isSaas);
  }

  async getActivePlan(organizationId: string): Promise<PlanInfo> {
    // BillingModule lifts the limits for an impersonating operator; this source never does.
    const overrideAddingLimitations = false;

    // Unreachable through the wiring: a self-hosted deployment resolves its plan from the
    // license provider, and this one is only constructed on the SaaS branch. It answers the
    // free baseline rather than a tier, because a plan resolved without a subscription and
    // without a license is not a plan anyone bought.
    if (!this.isSaas) {
      return {
        ...getFreePlanLimits(),
        overrideAddingLimitations,
      };
    }

    // An organization is not supposed to hold two active subscriptions, but
    // it can, and then which one answers decides the plan.
    const activeSubscription = await this.subscriptions.findActive(organizationId);

    const customLimits: Partial<PlanInfo> = {};
    for (const field of NUMERIC_OVERRIDE_FIELDS) {
      if (activeSubscription?.[field] != null) {
        customLimits[field] = activeSubscription[field]!;
      }
    }

    if (!activeSubscription) {
      return {
        ...getFreePlanLimits(),
        overrideAddingLimitations,
      };
    }

    const subscriptionPlan = activeSubscription.plan as string | undefined;
    const isKnownPlan = subscriptionPlan != null && subscriptionPlan in PLAN_LIMITS;

    if (isKnownPlan) {
      return {
        ...PLAN_LIMITS[subscriptionPlan as PlanTypes],
        ...customLimits,
        overrideAddingLimitations,
      };
    }

    return {
      ...getFreePlanLimits(),
      ...customLimits,
      overrideAddingLimitations,
    };
  }
}
