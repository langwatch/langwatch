import type { PrismaClient } from "@prisma/client";
import { env } from "../../src/env.mjs";
import type { PlanInfo } from "../licensing/planInfo";
import { PLAN_LIMITS } from "./planLimits";
import { PlanTypes, SubscriptionStatus } from "./planTypes";

type MinimalUser = {
  id?: string;
  email?: string | null;
  name?: string | null;
  impersonator?: {
    email?: string | null;
  };
};


const isAdmin = (user?: { email?: string | null }) => {
  if (!user?.email) {
    return false;
  }

  const adminEmails = env.ADMIN_EMAILS;
  if (!adminEmails) {
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
      if (activeSubscription?.maxMembers != null) {
        customLimits.maxMembers = activeSubscription.maxMembers;
      }
      if (activeSubscription?.maxProjects != null) {
        customLimits.maxProjects = activeSubscription.maxProjects;
      }
      if (activeSubscription?.maxMessagesPerMonth != null) {
        customLimits.maxMessagesPerMonth =
          activeSubscription.maxMessagesPerMonth;
      }
      if (activeSubscription?.evaluationsCredit != null) {
        customLimits.evaluationsCredit = activeSubscription.evaluationsCredit;
      }

      if (!activeSubscription) {
        return {
          ...PLAN_LIMITS[PlanTypes.FREE],
          overrideAddingLimitations,
        };
      }

      const subscriptionPlan = activeSubscription.plan as string | undefined;
      const resolvedPlan =
        subscriptionPlan && subscriptionPlan in PLAN_LIMITS
          ? (subscriptionPlan as keyof typeof PLAN_LIMITS)
          : PlanTypes.FREE;

      return {
        ...PLAN_LIMITS[resolvedPlan],
        ...customLimits,
        overrideAddingLimitations,
      };
    },
  };
};
