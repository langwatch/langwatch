import {
  BillingService,
  getFreePlanLimits,
  PLAN_LIMITS,
  type PlanTypes,
} from "@langwatch/enterprise-billing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import type {
  BillingSubscriptionRecord,
  BillingSubscriptionRepository,
} from "../ports/subscription.port";

// Fields that exist on both PlanInfo (as number) and Subscription (as Int?)
type NumericOverrideField = "maxMembers" | "maxMembersLite" | "maxMessagesPerMonth";

export const NUMERIC_OVERRIDE_FIELDS: NumericOverrideField[] = [
  "maxMembers",
  "maxMembersLite",
  "maxMessagesPerMonth",
];

type MinimalUser = {
  id?: string;
  email?: string | null;
  name?: string | null;
  impersonator?: {
    email?: string | null;
  };
};

const isAdmin = (adminEmails: ReadonlySet<string>, user?: { email?: string | null }) => {
  if (!user?.email) {
    return false;
  }

  return adminEmails.has(user.email);
};

export class SaaSPlanProviderService extends BillingService {
  private constructor(
    private readonly subscriptions: BillingSubscriptionRepository,
    private readonly isSaas: boolean,
    private readonly adminEmails: ReadonlySet<string>,
  ) {
    super();
  }

  static create(options: {
    subscriptions: BillingSubscriptionRepository;
    isSaas: boolean;
    adminEmails?: string | readonly string[];
  }): SaaSPlanProviderService {
    const emails =
      typeof options.adminEmails === "string"
        ? options.adminEmails.split(",").map((value) => value.trim())
        : (options.adminEmails ?? []);
    return new SaaSPlanProviderService(
      options.subscriptions,
      options.isSaas,
      new Set(emails),
    );
  }

  async getActivePlan(organizationId: string, user?: MinimalUser): Promise<PlanInfo> {
    const overrideAddingLimitations =
      !!user?.impersonator && isAdmin(this.adminEmails, user.impersonator);

    // Unreachable through the wiring: a self-hosted deployment resolves its
    // plan from the license provider, and this one is only constructed on
    // the SaaS branch. It answers the free baseline rather than a tier,
    // because a plan resolved without a subscription and without a license
    // is not a plan anyone bought. Answering Enterprise here would hand a
    // deployment that reached this line by mistake every entitlement the
    // top tier carries, signed webhook delivery included.
    if (!this.isSaas) {
      return {
        ...getFreePlanLimits(),
        overrideAddingLimitations,
      };
    }

    // An organization is not supposed to hold two active subscriptions, but
    // it can, and then which one answers decides the plan.
    const activeSubscription = await this.subscriptions.tryFindActive(organizationId);

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
