import { PlanTypes, SubscriptionStatus } from "@prisma/client";

import {
  SubscriptionHandler,
  type PlanInfo,
} from "../langwatch/langwatch/src/server/subscriptionHandler";
import { prisma } from "../langwatch/langwatch/src/server/db";
import { isAdmin } from "./utils/auth";

const PLAN_LIMITS: Record<PlanTypes, PlanInfo> = {
  [PlanTypes.FREE]: {
    type: PlanTypes.FREE,
    name: "Free",
    free: true,
    maxMembers: 1,
    maxProjects: 1,
    maxMessagesPerMonth: 1000,
    maxWorkflows: 0,
    evaluationsCredit: 2,
    prices: {
      USD: 0,
      EUR: 0,
    },
  },
  [PlanTypes.PRO]: {
    type: PlanTypes.PRO,
    name: "Pro",
    free: false,
    maxMembers: 5,
    maxProjects: 2,
    maxMessagesPerMonth: 10_000,
    evaluationsCredit: 10,
    maxWorkflows: 1,
    prices: {
      USD: 99,
      EUR: 99,
    },
  },
  [PlanTypes.LAUNCH]: {
    type: PlanTypes.LAUNCH,
    name: "Launch",
    free: false,
    maxMembers: 1,
    maxProjects: 1,
    maxWorkflows: 10,
    maxMessagesPerMonth: 10_000,
    evaluationsCredit: 10,
    prices: {
      USD: 149,
      EUR: 149,
    },
  },
  [PlanTypes.LAUNCH_ANNUAL]: {
    type: PlanTypes.LAUNCH_ANNUAL,
    name: "Launch Annual",
    free: false,
    maxMembers: 1,
    maxProjects: 1,
    maxWorkflows: 10,
    maxMessagesPerMonth: 10_000,
    evaluationsCredit: 10,
    prices: {
      USD: 1644,
      EUR: 1644,
    },
  },

  [PlanTypes.ACCELERATE]: {
    type: PlanTypes.ACCELERATE,
    name: "Accelerate",
    free: false,
    maxMembers: 10,
    maxProjects: 10,
    maxWorkflows: 50,
    maxMessagesPerMonth: 10_000,
    evaluationsCredit: 10,
    prices: {
      USD: 499,
      EUR: 499,
    },
  },
  [PlanTypes.ACCELERATE_ANNUAL]: {
    type: PlanTypes.ACCELERATE_ANNUAL,
    name: "Accelerate Annual",
    free: false,
    maxMembers: 10,
    maxProjects: 10,
    maxWorkflows: 50,
    maxMessagesPerMonth: 10_000,
    evaluationsCredit: 10,
    prices: {
      USD: 5484,
      EUR: 5484,
    },
  },
  [PlanTypes.GROWTH]: {
    type: PlanTypes.GROWTH,
    name: "Growth",
    free: false,
    maxMembers: 10,
    maxProjects: 5,
    maxWorkflows: 1,
    maxMessagesPerMonth: 100_000,
    evaluationsCredit: 50,
    prices: {
      USD: 399,
      EUR: 399,
    },
  },
  [PlanTypes.ENTERPRISE]: {
    type: PlanTypes.ENTERPRISE,
    name: "Enterprise",
    free: false,
    maxMembers: 1000,
    maxProjects: 100,
    maxWorkflows: 999,
    maxMessagesPerMonth: 1_000_000,
    evaluationsCredit: 500,
    prices: {
      USD: 999,
      EUR: 999,
    },
  },
};

export class SubscriptionHandlerSaas extends SubscriptionHandler {
  static async getActivePlan(
    organizationId: string,
    user?: any & {
      impersonator?: {
        email: string;
      };
    }
  ): Promise<PlanInfo> {
    const overrideAddingLimitations =
      user?.impersonator && isAdmin(user?.impersonator);

    if (process.env.IS_ONPREM === "true") {
      return {
        ...PLAN_LIMITS[PlanTypes.ENTERPRISE],
        overrideAddingLimitations,
      };
    }

    if (organizationId === "organization_lVWdCVtaqNXSKXtQYwU-y") {
      return { ...PLAN_LIMITS[PlanTypes.GROWTH], overrideAddingLimitations };
    }

    if (
      organizationId === "HXECRq2mRfSQpxTiSCcsS" ||
      organizationId === "organization_wGxIz2Tiwl8BFDHFHZMz_" ||
      organizationId === "organization_NW_jBe8d0CCKSnK8FW8UD" ||
      organizationId === "organization_z0JEOAFun8ldnzTQgFxVA" ||
      organizationId === "organization_3ko1Hf2jnsH8ElKJflyoS" ||
      organizationId === "organization_GkOKv2yG8QnVk6GLoWYRX" ||
      organizationId === "organization_T682QXSkRKv5_mKL2bMgi" ||
      organizationId === "organization_-jXj8RDPHXCOneoHJCsKF"
    ) {
      return { ...PLAN_LIMITS[PlanTypes.GROWTH], overrideAddingLimitations };
    }

    if (
      organizationId === "organization_erk6Bmlfzxw2YMyzWdo8O" ||
      organizationId === "organization_Kx6Yhg2CNw7Vvc9XifSf9" || // namastex (langflow)
      organizationId === "organization_0XObFvKWp0G6-v6fwqphq" // langflow
    ) {
      return {
        ...PLAN_LIMITS[PlanTypes.ENTERPRISE],
        overrideAddingLimitations,
      };
    }

    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        organizationId: organizationId,
        status: {
          in: [SubscriptionStatus.ACTIVE],
        },
      },
    });

    let customLimits: Partial<PlanInfo> = {};
    if (activeSubscription?.maxMembers) {
      customLimits.maxMembers = activeSubscription.maxMembers;
    }
    if (activeSubscription?.maxProjects) {
      customLimits.maxProjects = activeSubscription.maxProjects;
    }
    if (activeSubscription?.maxMessagesPerMonth) {
      customLimits.maxMessagesPerMonth = activeSubscription.maxMessagesPerMonth;
    }

    if (activeSubscription?.evaluationsCredit) {
      customLimits.evaluationsCredit = activeSubscription.evaluationsCredit;
    }

    if (!activeSubscription) {
      return { ...PLAN_LIMITS[PlanTypes.FREE], overrideAddingLimitations };
    }

    return {
      ...PLAN_LIMITS[activeSubscription.plan],
      ...customLimits,
      overrideAddingLimitations,
    };
  }
}
