import type { PrismaClient } from "@prisma/client";
import { env } from "../../../src/env.mjs";
import { prisma } from "../../../src/server/db";
import { captureException } from "../../../src/utils/posthogErrorCapture";
import { notifyResourceLimit } from "./notificationHandlers";
import { LIMIT_TYPE_DISPLAY_LABELS } from "../../../src/server/license-enforcement/constants";
import { getApp } from "../../../src/server/app-layer/app";
import type { ResourceLimitNotifierInput } from "../types";

const MIN_HOURS_BETWEEN_ALERTS = 24;

const updateResourceLimitAlert = async (
  db: PrismaClient,
  organizationId: string,
) => {
  await db.organization.update({
    where: { id: organizationId },
    data: {
      sentResourceLimitAlert: new Date(),
    },
  });
};

export const createResourceLimitNotifier = (db: PrismaClient = prisma) => {
  return async ({
    organizationId,
    limitType,
    current,
    max,
  }: ResourceLimitNotifierInput) => {
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

    if (organization.sentResourceLimitAlert) {
      const hoursSinceLastAlert =
        (Date.now() - organization.sentResourceLimitAlert.getTime()) /
        (1000 * 60 * 60);

      if (hoursSinceLastAlert < MIN_HOURS_BETWEEN_ALERTS) {
        return;
      }
    }

    const admin = organization.members[0]?.user;
    const limitLabel = LIMIT_TYPE_DISPLAY_LABELS[limitType];

    let planName = "unknown";
    try {
      const plan = await getApp().planProvider.getActivePlan({
        organizationId,
      });
      planName = plan.name ?? "unknown";
    } catch {
      // Plan name is for display only — proceed with fallback
    }

    await notifyResourceLimit({
      organizationId,
      organizationName: organization.name,
      adminName: admin?.name ?? undefined,
      adminEmail: admin?.email ?? undefined,
      planName,
      limitType: limitLabel,
      current,
      max,
    });

    try {
      await updateResourceLimitAlert(db, organizationId);
    } catch (error) {
      captureException(
        new Error(
          `Critical: resource limit notification sent but DB timestamp update failed for org ${organizationId} limitType ${limitType}`,
          { cause: error },
        ),
      );
    }
  };
};
