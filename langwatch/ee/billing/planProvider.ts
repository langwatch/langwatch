import type { PrismaClient, Subscription } from "@prisma/client";
import { env } from "../../src/env.mjs";
import type { PlanInfo } from "../licensing/planInfo";
import { PLAN_LIMITS, getFreePlanLimits } from "./planLimits";
import { PlanTypes, SubscriptionStatus } from "./planTypes";

// Fields that exist on both PlanInfo (as number) and Subscription (as Int?)
type NumericOverrideField = {
  [K in keyof PlanInfo & keyof Subscription]: PlanInfo[K] extends number
    ? K
    : never;
}[keyof PlanInfo & keyof Subscription];

export const NUMERIC_OVERRIDE_FIELDS: NumericOverrideField[] = [
  "maxMembers",
  "maxMembersLite",
  "maxProjects",
  "maxMessagesPerMonth",
  "evaluationsCredit",
  "maxWorkflows",
  "maxTeams",
  "maxPrompts",
  "maxEvaluators",
  "maxScenarios",
  "maxAgents",
  "maxExperiments",
  "maxOnlineEvaluations",
  "maxDatasets",
  "maxDashboards",
  "maxCustomGraphs",
  "maxAutomations",
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

export const createSaaSPlanProvider = (
  db: PrismaClient,
): SaaSPlanProvider => {
  return {
    async getActivePlan(organizationId, user) {
      const overrideAddingLimitations =
        !!user?.impersonator && isAdmin(user.impersonator);

      if (!env.IS_SAAS) {
        return {
          ...PLAN_LIMITS[PlanTypes.ENTERPRISE],
          overrideAddingLimitations,
        };
      }

      const activeSubscription = await db.subscription.findFirst({
        where: {
          organizationId,
          status: {
            in: [SubscriptionStatus.ACTIVE],
          },
        },
        orderBy: { createdAt: "desc" },
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
          activeTrial: false,
          overrideAddingLimitations,
        };
      }

      // Handle trial subscriptions
      if (activeSubscription.isTrial) {
        const now = new Date();
        if (activeSubscription.endDate && activeSubscription.endDate <= now) {
          // Trial expired — attempt to cancel, but always return FREE
          try {
            await db.subscription.update({
              where: { id: activeSubscription.id },
              data: {
                status: SubscriptionStatus.CANCELLED,
              },
            });
          } catch {
            // Ignore write failures — still return FREE
          }
          return {
            ...getFreePlanLimits(),
            activeTrial: false,
            overrideAddingLimitations,
          };
        }

        // Trial still active
        const subscriptionPlan = activeSubscription.plan as string | undefined;
        const isKnownPlan =
          subscriptionPlan != null && subscriptionPlan in PLAN_LIMITS;

        return {
          ...(isKnownPlan
            ? PLAN_LIMITS[subscriptionPlan as keyof typeof PLAN_LIMITS]
            : getFreePlanLimits()),
          ...customLimits,
          activeTrial: true,
          trialEndDate: activeSubscription.endDate,
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
          activeTrial: false,
          overrideAddingLimitations,
        };
      }

      return {
        ...getFreePlanLimits(),
        ...customLimits,
        activeTrial: false,
        overrideAddingLimitations,
      };
    },
  };
};
