import type { PrismaClient } from "@prisma/client";
import type { PlanInfo } from "../licensing/planInfo";

export type BillingDeps = {
  prisma: PrismaClient;
};

export type BillingPlanProvider = {
  getActivePlan(
    organizationId: string,
    user?: {
      id?: string;
      email?: string | null;
      name?: string | null;
      impersonator?: {
        email?: string | null;
      };
    },
  ): Promise<PlanInfo>;
};

export type PlanLimitNotifierInput = {
  organizationId: string;
  planName: string;
};

export type PlanLimitNotificationContext = {
  organizationId: string;
  organizationName: string;
  adminName?: string;
  adminEmail?: string;
  planName: string;
};

export type PlanLimitNotificationHandlers = {
  sendSlackNotification?: (
    context: PlanLimitNotificationContext,
  ) => Promise<void> | void;
  sendHubspotNotification?: (
    context: PlanLimitNotificationContext,
  ) => Promise<void> | void;
};
