import type { PrismaClient } from "@prisma/client";
import { env } from "../../src/env.mjs";
import { prisma } from "../../src/server/db";
import { captureException } from "../../src/utils/posthogErrorCapture";
import { notifyPlanLimit } from "./notificationHandlers";
import type {
  PlanLimitNotificationContext,
  PlanLimitNotifierInput,
} from "./types";

const DAYS_SINCE_LAST_ALERT = 30;

const updatePlanLimitMessages = async (
  db: PrismaClient,
  organizationId: string,
) => {
  await db.organization.update({
    where: { id: organizationId },
    data: {
      sentPlanLimitAlert: new Date(),
    },
  });
};

export const createPlanLimitNotifier = (db: PrismaClient = prisma) => {
  return async ({ organizationId, planName }: PlanLimitNotifierInput) => {
    if (!env.IS_SAAS) {
      return;
    }

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      include: {
        members: {
          where: { role: "ADMIN" },
          include: {
            user: true,
          },
        },
      },
    });

    if (!organization) {
      return;
    }

    if (organization.sentPlanLimitAlert) {
      const timeSinceLastAlert =
        Date.now() - organization.sentPlanLimitAlert.getTime();
      const daysSinceLastAlert = Math.floor(
        timeSinceLastAlert / (1000 * 60 * 60 * 24),
      );

      if (daysSinceLastAlert < DAYS_SINCE_LAST_ALERT) {
        return;
      }
    }

    try {
      await updatePlanLimitMessages(db, organizationId);
    } catch (error) {
      captureException(error);
    }

    const admin = organization.members[0]?.user;

    const context: PlanLimitNotificationContext = {
      organizationId,
      organizationName: organization.name,
      adminName: admin?.name ?? undefined,
      adminEmail: admin?.email ?? undefined,
      planName,
    };

    await notifyPlanLimit(context);
  };
};
