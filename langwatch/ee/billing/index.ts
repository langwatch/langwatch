import { prisma } from "../../src/server/db";
import { createPlanLimitNotifier } from "./planLimitNotifier";
import {
  clearBillingNotificationHandlers,
  clearPlanLimitNotificationHandlers,
  notifySubscriptionEvent,
  setBillingNotificationHandlers,
  setPlanLimitNotificationHandlers,
} from "./notificationHandlers";
import { createSaaSPlanProvider } from "./planProvider";
import { createSubscriptionRouter } from "./subscriptionRouter";
import { createStripeWebhookHandler } from "./stripeWebhook";

export { PlanTypes, SubscriptionStatus } from "./planTypes";
export { PLAN_LIMITS } from "./planLimits";
export { prices } from "./stripeHelpers";
export type {
  BillingNotificationHandlers,
  BillingPlanProvider,
  PlanLimitNotificationContext,
  PlanLimitNotificationHandlers,
  PlanLimitNotifierInput,
  SubscriptionNotificationPayload,
} from "./types";
export {
  clearBillingNotificationHandlers,
  clearPlanLimitNotificationHandlers,
  notifySubscriptionEvent,
  setBillingNotificationHandlers,
  setPlanLimitNotificationHandlers,
};

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
