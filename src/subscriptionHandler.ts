import { PlanTypes, SubscriptionStatus } from "@prisma/client";

import {
  SubscriptionHandler,
  type PlanInfo,
} from "../langwatch/langwatch/src/server/subscriptionHandler";
import { prisma } from "../langwatch/langwatch/src/server/db";
import { isAdmin } from "./utils/auth";

const PLAN_LIMITS: Record<PlanTypes, PlanInfo> = {
  [PlanTypes.FREE]: {
    name: "Free",
    free: true,
    maxMembers: 1,
    maxProjects: 1,
    maxMessagesPerMonth: 1000,
    evaluationsCredit: 2,
    prices: {
      USD: 0,
      EUR: 0,
    },
  },
  [PlanTypes.PRO]: {
    name: "Pro",
    free: false,
    maxMembers: 5,
    maxProjects: 2,
    maxMessagesPerMonth: 10_000,
    evaluationsCredit: 10,
    prices: {
      USD: 99,
      EUR: 99,
    },
  },
  [PlanTypes.GROWTH]: {
    name: "Growth",
    free: false,
    maxMembers: 10,
    maxProjects: 5,
    maxMessagesPerMonth: 100_000,
    evaluationsCredit: 50,
    prices: {
      USD: 399,
      EUR: 399,
    },
  },
  [PlanTypes.ENTERPRISE]: {
    name: "Enterprise",
    free: false,
    maxMembers: 1000,
    maxProjects: 100,
    maxMessagesPerMonth: 1_000_000,
    evaluationsCredit: 500,
    prices: {
      USD: 999,
      EUR: 999,
    },
  },
};

export class SubscriptionHandlerSass extends SubscriptionHandler {
  static async getActivePlan(
    organizationId: string,
    user?: any & {
      impersonator?: {
        email: string;
      };
    }
  ): Promise<PlanInfo> {
    const canAlwaysAddNewMembers =
      user?.impersonator && isAdmin(user?.impersonator);

    if (
      organizationId === "HXECRq2mRfSQpxTiSCcsS" ||
      organizationId === "organization_wGxIz2Tiwl8BFDHFHZMz_" ||
      organizationId === "organization_NW_jBe8d0CCKSnK8FW8UD" ||
      organizationId === "organization_z0JEOAFun8ldnzTQgFxVA"
    ) {
      return { ...PLAN_LIMITS[PlanTypes.GROWTH], canAlwaysAddNewMembers };
    }

    if (organizationId === "organization_erk6Bmlfzxw2YMyzWdo8O") {
      return { ...PLAN_LIMITS[PlanTypes.ENTERPRISE], canAlwaysAddNewMembers };
    }

    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        organizationId: organizationId,
        status: {
          in: [SubscriptionStatus.ACTIVE],
        },
      },
    });

    if (!activeSubscription)
      return { ...PLAN_LIMITS[PlanTypes.FREE], canAlwaysAddNewMembers };

    return { ...PLAN_LIMITS[activeSubscription.plan], canAlwaysAddNewMembers };
  }
}
