import { prisma } from "../../src/server/db";
import {
  clearPlanLimitNotificationHandlers,
  createPlanLimitNotifier,
  setPlanLimitNotificationHandlers,
} from "./planLimitNotifier";
import { createSaaSPlanProvider } from "./planProvider";
import { createSubscriptionRouter } from "./subscriptionRouter";
import { createStripeWebhookHandler } from "./stripeWebhook";

export { PlanTypes, SubscriptionStatus } from "./planTypes";
export { PLAN_LIMITS } from "./planLimits";
export { prices } from "./stripeHelpers";
export type {
  BillingPlanProvider,
  PlanLimitNotificationContext,
  PlanLimitNotificationHandlers,
  PlanLimitNotifierInput,
} from "./types";
export { clearPlanLimitNotificationHandlers, setPlanLimitNotificationHandlers };

export { createSubscriptionRouter, createStripeWebhookHandler };

let saasPlanProvider: ReturnType<typeof createSaaSPlanProvider> | null = null;

export const getSaaSPlanProvider = () => {
  if (!saasPlanProvider) {
    saasPlanProvider = createSaaSPlanProvider(prisma);
  }

  return saasPlanProvider;
};

let planLimitNotifier: ReturnType<typeof createPlanLimitNotifier> | null = null;

export const notifyPlanLimitReached = async (input: {
  organizationId: string;
  planName: string;
}) => {
  if (!planLimitNotifier) {
    planLimitNotifier = createPlanLimitNotifier(prisma);
  }

  return await planLimitNotifier(input);
};
