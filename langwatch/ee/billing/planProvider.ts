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

const GROWTH_ORGANIZATION_IDS = new Set([
  "organization_lVWdCVtaqNXSKXtQYwU-y",
  "organization_wGxIz2Tiwl8BFDHFHZMz_",
  "organization_NW_jBe8d0CCKSnK8FW8UD",
  "organization_z0JEOAFun8ldnzTQgFxVA",
  "organization_3ko1Hf2jnsH8ElKJflyoS",
  "organization_GkOKv2yG8QnVk6GLoWYRX",
  "organization_T682QXSkRKv5_mKL2bMgi",
  "organization_-jXj8RDPHXCOneoHJCsKF",
]);

const ENTERPRISE_ORGANIZATION_IDS = new Set([
  "organization_erk6Bmlfzxw2YMyzWdo8O",
  "organization_Kx6Yhg2CNw7Vvc9XifSf9",
  "organization_0XObFvKWp0G6-v6fwqphq",
]);

const isAdmin = (user?: { email?: string | null }) => {
  if (!user?.email) {
    return false;
  }

  const adminEmails = process.env.ADMIN_EMAILS;
  return !!adminEmails && adminEmails.split(",").includes(user.email);
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

      if (GROWTH_ORGANIZATION_IDS.has(organizationId)) {
        return {
          ...PLAN_LIMITS[PlanTypes.GROWTH],
          overrideAddingLimitations,
        };
      }

      if (ENTERPRISE_ORGANIZATION_IDS.has(organizationId)) {
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
      if (activeSubscription?.maxMembers) {
        customLimits.maxMembers = activeSubscription.maxMembers;
      }
      if (activeSubscription?.maxProjects) {
        customLimits.maxProjects = activeSubscription.maxProjects;
      }
      if (activeSubscription?.maxMessagesPerMonth) {
        customLimits.maxMessagesPerMonth =
          activeSubscription.maxMessagesPerMonth;
      }
      if (activeSubscription?.evaluationsCredit) {
        customLimits.evaluationsCredit = activeSubscription.evaluationsCredit;
      }

      if (!activeSubscription) {
        return {
          ...PLAN_LIMITS[PlanTypes.FREE],
          overrideAddingLimitations,
        };
      }

      const subscriptionPlan = activeSubscription.plan as
        | keyof typeof PLAN_LIMITS
        | undefined;

      return {
        ...PLAN_LIMITS[subscriptionPlan ?? PlanTypes.FREE],
        ...customLimits,
        overrideAddingLimitations,
      };
    },
  };
};
