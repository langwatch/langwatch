import { captureException } from "../../src/utils/posthogErrorCapture";
import type {
  BillingNotificationHandlers,
  PlanLimitNotificationContext,
  SubscriptionNotificationPayload,
} from "./types";

let billingNotificationHandlers: BillingNotificationHandlers = {};

export const setBillingNotificationHandlers = (
  handlers: BillingNotificationHandlers,
) => {
  billingNotificationHandlers = { ...billingNotificationHandlers, ...handlers };
};

export const clearBillingNotificationHandlers = () => {
  billingNotificationHandlers = {};
};

const runHandlerSafely = async <T>(
  handler: ((payload: T) => Promise<void> | void) | undefined,
  payload: T,
) => {
  if (!handler) {
    return;
  }

  try {
    await handler(payload);
  } catch (error) {
    captureException(error);
  }
};

export const notifyPlanLimit = async (
  context: PlanLimitNotificationContext,
) => {
  await Promise.all([
    runHandlerSafely(billingNotificationHandlers.sendSlackNotification, context),
    runHandlerSafely(
      billingNotificationHandlers.sendHubspotNotification,
      context,
    ),
  ]);
};

export const notifySubscriptionEvent = async (
  payload: SubscriptionNotificationPayload,
) => {
  await runHandlerSafely(
    billingNotificationHandlers.sendSubscriptionNotification,
    payload,
  );
};
