import type { PrismaClient } from "@prisma/client";
import { env } from "../../../src/env.mjs";
import { notifyResourceLimit } from "./notificationHandlers";
import { LIMIT_TYPE_DISPLAY_LABELS } from "../../../src/server/license-enforcement/constants";
import { getApp } from "../../../src/server/app-layer/app";
import { TtlCache } from "../../../src/server/utils/ttlCache";
import type { ResourceLimitNotifierInput } from "../types";

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export const cooldownCache = new TtlCache<true>(COOLDOWN_MS);

export const createResourceLimitNotifier = (db: PrismaClient) => {
  return async ({
    organizationId,
    limitType,
    current,
    max,
  }: ResourceLimitNotifierInput) => {
    if (!env.IS_SAAS) {
      return;
    }

    if (cooldownCache.get(organizationId)) {
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

    cooldownCache.set(organizationId, true);
  };
};
