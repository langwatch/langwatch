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
  },
  [PlanTypes.TEAM]: {
    name: "Team",
    free: false,
    maxMembers: 5,
    maxProjects: 2,
    maxMessagesPerMonth: 10_000,
    evaluationsCredit: 10,
  },
  [PlanTypes.BUSINESS]: {
    name: "Business",
    free: false,
    maxMembers: 100,
    maxProjects: 5,
    maxMessagesPerMonth: 100_000,
    evaluationsCredit: 50,
  },
  [PlanTypes.ENTERPRISE]: {
    name: "Enterprise",
    free: false,
    maxMembers: 1000,
    maxProjects: 100,
    maxMessagesPerMonth: 1_000_000,
    evaluationsCredit: 500,
  },
};

export class SubscriptionHandlerSass extends SubscriptionHandler {
  static async getActivePlan(
    user: any & {
      impersonator?: {
        email: string;
      };
    },
    organizationId: string
  ): Promise<PlanInfo> {
    const canAlwaysAddNewMembers =
      user.impersonator && isAdmin(user.impersonator);

    if (
      organizationId === "organization_erk6Bmlfzxw2YMyzWdo8O" ||
      organizationId === "HXECRq2mRfSQpxTiSCcsS" ||
      organizationId === "XpdrHl5j4YrD6VWJffq5k" ||
      organizationId === "organization_wGxIz2Tiwl8BFDHFHZMz_" ||
      organizationId === "organization_NW_jBe8d0CCKSnK8FW8UD" ||
      organizationId === "organization_z0JEOAFun8ldnzTQgFxVA"
    ) {
      return { ...PLAN_LIMITS[PlanTypes.BUSINESS], canAlwaysAddNewMembers };
    }

    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        organizationId: organizationId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
        },
      },
    });

    if (!activeSubscription)
      return { ...PLAN_LIMITS[PlanTypes.FREE], canAlwaysAddNewMembers };

    return { ...PLAN_LIMITS[activeSubscription.plan], canAlwaysAddNewMembers };
  }
}
