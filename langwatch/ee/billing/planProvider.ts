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
