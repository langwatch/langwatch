import { prisma } from "../../src/server/db";
import { createSaaSPlanProvider } from "./planProvider";
import { createCustomerService } from "./services/customerService";
import { createSeatEventSubscriptionFns } from "./services/seatEventSubscription";
import { createSeatSyncService } from "./services/seatSyncService";
import * as subscriptionItemCalculator from "./services/subscriptionItemCalculator";
import { EESubscriptionService } from "./services/subscription.service";
import { createStripeClient } from "./stripe/stripeClient";
import { createCurrencyRouter } from "./currencyRouter";
import { createSubscriptionRouterFactory } from "./subscriptionRouter";

export { PlanTypes, SubscriptionStatus } from "./planTypes";
export { PLAN_LIMITS } from "./planLimits";
export { prices } from "./services/subscriptionItemCalculator";
export type { UsageReportingService, MeterEventResult, UsageSummary } from "./services/usageReportingService";
export type {
  BillingPlanProvider,
  PlanLimitNotificationContext,
  PlanLimitNotifierInput,
  ResourceLimitNotificationContext,
  ResourceLimitNotifierInput,
  SubscriptionNotificationPayload,
} from "./types";

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
  const subscriptionService = EESubscriptionService.create({
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

let saasPlanProvider: ReturnType<typeof createSaaSPlanProvider> | null = null;

export const getSaaSPlanProvider = () => {
  if (!saasPlanProvider) {
    saasPlanProvider = createSaaSPlanProvider(prisma);
  }

  return saasPlanProvider;
};

