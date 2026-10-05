// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  BILLING_LIFECYCLE_EVENT_VERSION,
  CHECKOUT_COMPLETED_EVENT_TYPE,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  SUBSCRIPTION_STARTED_EVENT_TYPE,
  checkoutCompletedEventDataSchema,
  subscriptionChangedEventDataSchema,
  subscriptionStartedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const RECORD_SUBSCRIPTION_CHANGED_COMMAND_TYPE =
  "lw.billing.record_subscription_changed" as const;
export const RECORD_SUBSCRIPTION_STARTED_COMMAND_TYPE =
  "lw.billing.record_subscription_started" as const;
export const RECORD_CHECKOUT_COMPLETED_COMMAND_TYPE =
  "lw.billing.record_checkout_completed" as const;

export const recordSubscriptionChangedCommandDataSchema = subscriptionChangedEventDataSchema;
export type RecordSubscriptionChangedCommandData = z.infer<
  typeof recordSubscriptionChangedCommandDataSchema
>;
export const recordSubscriptionStartedCommandDataSchema = subscriptionStartedEventDataSchema;
export type RecordSubscriptionStartedCommandData = z.infer<
  typeof recordSubscriptionStartedCommandDataSchema
>;
export const recordCheckoutCompletedCommandDataSchema = checkoutCompletedEventDataSchema;
export type RecordCheckoutCompletedCommandData = z.infer<
  typeof recordCheckoutCompletedCommandDataSchema
>;

export const subscriptionChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SUBSCRIPTION_CHANGED_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: subscriptionChangedEventDataSchema,
});
export type SubscriptionChangedEvent = z.infer<typeof subscriptionChangedEventSchema>;

export const subscriptionStartedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SUBSCRIPTION_STARTED_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: subscriptionStartedEventDataSchema,
});
export type SubscriptionStartedEvent = z.infer<typeof subscriptionStartedEventSchema>;

export const checkoutCompletedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CHECKOUT_COMPLETED_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: checkoutCompletedEventDataSchema,
});
export type CheckoutCompletedEvent = z.infer<typeof checkoutCompletedEventSchema>;

export type BillingLifecycleEvent =
  | SubscriptionChangedEvent
  | SubscriptionStartedEvent
  | CheckoutCompletedEvent;
