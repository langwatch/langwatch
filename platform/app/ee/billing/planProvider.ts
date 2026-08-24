import type { PrismaClient, Subscription } from "~/generated/prisma/client";
import { env } from "../../src/env.mjs";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { getFreePlanLimits, PLAN_LIMITS } from "./planLimits";
import { ACTIVE_SUBSCRIPTION_ORDER_BY, SubscriptionStatus } from "./planTypes";

// Fields that exist on both PlanInfo (as number) and Subscription (as Int?)
type NumericOverrideField = {
  [K in keyof PlanInfo & keyof Subscription]: PlanInfo[K] extends number
    ? K
    : never;
}[keyof PlanInfo & keyof Subscription];

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

export const isAdmin = (user?: { email?: string | null }) => {
  if (!user?.email) {
    return false;
  }

  const adminEmails = env.ADMIN_EMAILS;
  if (!adminEmails || typeof adminEmails !== "string") {
    return false;
  }

  const adminSet = new Set(adminEmails.split(",").map((s) => s.trim()));
  return adminSet.has(user.email);
};

export type SaaSPlanProvider = {
  getActivePlan(organizationId: string, user?: MinimalUser): Promise<PlanInfo>;
};

export const createSaaSPlanProvider = (db: PrismaClient): SaaSPlanProvider => {
  return {
    async getActivePlan(organizationId, user) {
      const overrideAddingLimitations =
        !!user?.impersonator && isAdmin(user.impersonator);

      // Unreachable through the wiring: a self-hosted deployment resolves its
      // plan from the license provider, and this one is only constructed on
      // the SaaS branch. It answers the free baseline rather than a tier,
      // because a plan resolved without a subscription and without a license
      // is not a plan anyone bought. Answering Enterprise here would hand a
      // deployment that reached this line by mistake every entitlement the
      // top tier carries, signed webhook delivery included.
      if (!env.IS_SAAS) {
        return {
          ...getFreePlanLimits(),
          overrideAddingLimitations,
        };
      }

      // An organization is not supposed to hold two active subscriptions, but
      // it can, and then which one answers decides the plan.
      const activeSubscription = await db.subscription.findFirst({
        where: {
          organizationId,
          status: {
            in: [SubscriptionStatus.ACTIVE],
          },
        },
        orderBy: [...ACTIVE_SUBSCRIPTION_ORDER_BY],
      });

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
      const isKnownPlan =
        subscriptionPlan != null && subscriptionPlan in PLAN_LIMITS;

      if (isKnownPlan) {
        return {
          ...PLAN_LIMITS[subscriptionPlan as keyof typeof PLAN_LIMITS],
          ...customLimits,
          overrideAddingLimitations,
        };
      }

      return {
        ...getFreePlanLimits(),
        ...customLimits,
        overrideAddingLimitations,
      };
    },
  };
};
