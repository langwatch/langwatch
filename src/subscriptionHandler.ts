import { PlanTypes, SubscriptionStatus } from "@prisma/client";

import {
  SubscriptionHandler,
  type SubscriptionLimits,
} from "../langwatch/langwatch/src/server/subscriptionHandler";
import { prisma } from "../langwatch/langwatch/src/server/db";

const PLAN_LIMITS: Record<PlanTypes, SubscriptionLimits> = {
  [PlanTypes.FREE]: {
    maxMembers: 1,
  },
  [PlanTypes.STARTUP]: {
    maxMembers: 10,
  },
  [PlanTypes.ENTERPRISE]: {
    maxMembers: 1000,
  },
};

const getActivePlanLimits = async (
  organizationId: string
): Promise<SubscriptionLimits> => {
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
};

export class SubscriptionHandlerSass extends SubscriptionHandler {
  static async getLimits(organizationId: string): Promise<SubscriptionLimits> {
    return await getActivePlanLimits(organizationId);
  }
}
