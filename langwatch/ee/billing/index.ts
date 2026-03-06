import { prisma } from "../../src/server/db";
import { createPlanLimitNotifier } from "./notifications/planLimitNotifier";
import {
  clearBillingNotificationHandlers,
  notifySubscriptionEvent,
  setBillingNotificationHandlers,
} from "./notifications/notificationHandlers";
import { createSaaSPlanProvider } from "./planProvider";
import { createCustomerService } from "./services/customerService";
import { createSeatEventSubscriptionFns } from "./services/seatEventSubscription";
import { InviteService } from "../../src/server/invites/invite.service";
import { createSeatSyncService } from "./services/seatSyncService";
import { createSubscriptionService } from "./services/subscriptionService";
import * as subscriptionItemCalculator from "./services/subscriptionItemCalculator";
import { createWebhookService } from "./services/webhookService";
import { createStripeClient } from "./stripe/stripeClient";
import { createCurrencyRouter } from "./currencyRouter";
import { createSubscriptionRouterFactory } from "./subscriptionRouter";
import { createStripeWebhookHandlerFactory } from "./stripeWebhook";

export { PlanTypes, SubscriptionStatus } from "./planTypes";
export { PLAN_LIMITS } from "./planLimits";
export { prices } from "./services/subscriptionItemCalculator";
export type { UsageReportingService, MeterEventResult, UsageSummary } from "./services/usageReportingService";
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
  notifySubscriptionEvent,
  setBillingNotificationHandlers,
};

// Lazy Stripe singleton
let stripe: ReturnType<typeof createStripeClient> | null = null;
const getStripe = () => {
  if (!stripe) stripe = createStripeClient();
  return stripe;
};

export { createCurrencyRouter };

export const createSubscriptionRouter = () => {
  const s = getStripe();
  const customerService = createCustomerService({ stripe: s, db: prisma });
  const seatEventFns = createSeatEventSubscriptionFns({ stripe: s, db: prisma });
  const subscriptionService = createSubscriptionService({
    stripe: s,
    db: prisma,
    itemCalculator: subscriptionItemCalculator,
    seatEventFns,
  });
  return createSubscriptionRouterFactory({ customerService, subscriptionService });
};

let seatSyncServiceInstance: ReturnType<typeof createSeatSyncService> | null = null;

export const getSeatSyncService = () => {
  if (!seatSyncServiceInstance) {
    const s = getStripe();
    const seatEventFns = createSeatEventSubscriptionFns({ stripe: s, db: prisma });
    seatSyncServiceInstance = createSeatSyncService({ seatEventFns, db: prisma });
  }
  return seatSyncServiceInstance;
};

export const createStripeWebhookHandler = () => {
  const s = getStripe();
  const inviteApprover = InviteService.create(prisma);
  const webhookService = createWebhookService({
    db: prisma,
    stripe: s,
    itemCalculator: subscriptionItemCalculator,
    inviteApprover,
  });
  return createStripeWebhookHandlerFactory({ stripe: s, webhookService });
};

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
