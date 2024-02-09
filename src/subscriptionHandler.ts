import { PlanTypes, SubscriptionStatus } from "@prisma/client";

import {
  SubscriptionHandler,
  type PlanInfo,
} from "../langwatch/langwatch/src/server/subscriptionHandler";
import { prisma } from "../langwatch/langwatch/src/server/db";

const PLAN_LIMITS: Record<PlanTypes, PlanInfo> = {
  [PlanTypes.FREE]: {
    name: "Free",
    free: true,
    maxMembers: 1,
  },
  [PlanTypes.TEAM]: {
    name: "Team",
    free: false,
    maxMembers: 5,
  },
  [PlanTypes.BUSINESS]: {
    name: "Business",
    free: false,
    maxMembers: 100,
  },
  [PlanTypes.ENTERPRISE]: {
    name: "Enterprise",
    free: false,
    maxMembers: 1000,
  },
};

export class SubscriptionHandlerSass extends SubscriptionHandler {
  static async getActivePlan(organizationId: string): Promise<PlanInfo> {
    if (
      organizationId === "organization_erk6Bmlfzxw2YMyzWdo8O" ||
      organizationId === "HXECRq2mRfSQpxTiSCcsS" ||
      organizationId === "XpdrHl5j4YrD6VWJffq5k" ||
      organizationId === "organization_wGxIz2Tiwl8BFDHFHZMz_" ||
      organizationId === "organization_NW_jBe8d0CCKSnK8FW8UD" ||
      organizationId === "organization_z0JEOAFun8ldnzTQgFxVA"
    ) {
      return PLAN_LIMITS[PlanTypes.BUSINESS];
    }

    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        organizationId: organizationId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
        },
      },
    });

    if (!activeSubscription) return PLAN_LIMITS[PlanTypes.FREE];

    return PLAN_LIMITS[activeSubscription.plan];
  }
}
