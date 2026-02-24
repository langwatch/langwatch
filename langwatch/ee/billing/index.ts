import { prisma } from "../../src/server/db";
import { createPlanLimitNotifier } from "./notifications/planLimitNotifier";
import {
  clearBillingNotificationHandlers,
  notifySubscriptionEvent,
  setBillingNotificationHandlers,
} from "./notifications/notificationHandlers";
import { createSaaSPlanProvider } from "./planProvider";
import { createCustomerService } from "./services/customerService";
import { createSubscriptionService } from "./services/subscriptionService";
import { createUsageReportingService } from "./services/usageReportingService";
import * as subscriptionItemCalculator from "./services/subscriptionItemCalculator";
import { createWebhookService } from "./services/webhookService";
import { createStripeClient } from "./stripe/stripeClient";
import { meters } from "./stripe/stripePriceCatalog";
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
  const subscriptionService = createSubscriptionService({
    stripe: s,
    db: prisma,
    itemCalculator: subscriptionItemCalculator,
  });
  return createSubscriptionRouterFactory({ customerService, subscriptionService });
};

export const createStripeWebhookHandler = () => {
  const s = getStripe();
  const webhookService = createWebhookService({
    db: prisma,
    itemCalculator: subscriptionItemCalculator,
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

let usageReportingService: ReturnType<typeof createUsageReportingService> | null =
  null;

export const getUsageReportingService = () => {
  if (!usageReportingService) {
    usageReportingService = createUsageReportingService({
      stripe: getStripe(),
      meterId: meters.BILLABLE_EVENTS,
    });
  }
  return usageReportingService;
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
