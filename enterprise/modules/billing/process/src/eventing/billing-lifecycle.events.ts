// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  BILLING_AUDIT_RECORDED_EVENT_TYPE,
  BILLING_LIFECYCLE_EVENT_VERSION,
  CHECKOUT_COMPLETED_EVENT_TYPE,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  SUBSCRIPTION_STARTED_EVENT_TYPE,
  USAGE_BILLING_CHANGED_EVENT_TYPE,
  billingAuditRecordedEventDataSchema,
  PLAN_LIMIT_ALERT_SENT_EVENT_TYPE,
  CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE,
  PRICING_MODEL_CHANGED_EVENT_TYPE,
  SEAT_CHECKOUT_PAID_EVENT_TYPE,
  SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE,
  planLimitAlertSentEventDataSchema,
  checkoutCurrencySelectedEventDataSchema,
  pricingModelChangedEventDataSchema,
  seatCheckoutPaidEventDataSchema,
  seatCheckoutsAbandonedEventDataSchema,
  checkoutCompletedEventDataSchema,
  subscriptionChangedEventDataSchema,
  subscriptionStartedEventDataSchema,
  usageBillingChangedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const RECORD_SUBSCRIPTION_CHANGED_COMMAND_TYPE =
  "lw.billing.record_subscription_changed" as const;
export const RECORD_SUBSCRIPTION_STARTED_COMMAND_TYPE =
  "lw.billing.record_subscription_started" as const;
export const RECORD_CHECKOUT_COMPLETED_COMMAND_TYPE =
  "lw.billing.record_checkout_completed" as const;
export const RECORD_USAGE_BILLING_CHANGED_COMMAND_TYPE =
  "lw.billing.record_usage_billing_changed" as const;
export const RECORD_BILLING_AUDIT_COMMAND_TYPE = "lw.billing.record_audit" as const;

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

export const recordUsageBillingChangedCommandDataSchema = usageBillingChangedEventDataSchema;
export type RecordUsageBillingChangedCommandData = z.infer<
  typeof recordUsageBillingChangedCommandDataSchema
>;

export const recordBillingAuditCommandDataSchema = billingAuditRecordedEventDataSchema;
export type RecordBillingAuditCommandData = z.infer<typeof recordBillingAuditCommandDataSchema>;

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

export const usageBillingChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USAGE_BILLING_CHANGED_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: usageBillingChangedEventDataSchema,
});
export type UsageBillingChangedEvent = z.infer<typeof usageBillingChangedEventSchema>;

export const billingAuditRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(BILLING_AUDIT_RECORDED_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: billingAuditRecordedEventDataSchema,
});
export type BillingAuditRecordedEvent = z.infer<typeof billingAuditRecordedEventSchema>;

export const RECORD_PLAN_LIMIT_ALERT_SENT_COMMAND_TYPE =
  "lw.billing.record_plan_limit_alert_sent" as const;
export const recordPlanLimitAlertSentCommandDataSchema = planLimitAlertSentEventDataSchema;
export type RecordPlanLimitAlertSentCommandData = z.infer<
  typeof recordPlanLimitAlertSentCommandDataSchema
>;
export const planLimitAlertSentEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PLAN_LIMIT_ALERT_SENT_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: planLimitAlertSentEventDataSchema,
});
export type PlanLimitAlertSentEvent = z.infer<typeof planLimitAlertSentEventSchema>;

export const RECORD_CHECKOUT_CURRENCY_SELECTED_COMMAND_TYPE =
  "lw.billing.record_checkout_currency_selected" as const;
export const recordCheckoutCurrencySelectedCommandDataSchema =
  checkoutCurrencySelectedEventDataSchema;
export type RecordCheckoutCurrencySelectedCommandData = z.infer<
  typeof recordCheckoutCurrencySelectedCommandDataSchema
>;
export const checkoutCurrencySelectedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: checkoutCurrencySelectedEventDataSchema,
});
export type CheckoutCurrencySelectedEvent = z.infer<typeof checkoutCurrencySelectedEventSchema>;

export const RECORD_PRICING_MODEL_CHANGED_COMMAND_TYPE =
  "lw.billing.record_pricing_model_changed" as const;
export const recordPricingModelChangedCommandDataSchema = pricingModelChangedEventDataSchema;
export type RecordPricingModelChangedCommandData = z.infer<
  typeof recordPricingModelChangedCommandDataSchema
>;
export const pricingModelChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PRICING_MODEL_CHANGED_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: pricingModelChangedEventDataSchema,
});
export type PricingModelChangedEvent = z.infer<typeof pricingModelChangedEventSchema>;

export const RECORD_SEAT_CHECKOUT_PAID_COMMAND_TYPE =
  "lw.billing.record_seat_checkout_paid" as const;
export const recordSeatCheckoutPaidCommandDataSchema = seatCheckoutPaidEventDataSchema;
export type RecordSeatCheckoutPaidCommandData = z.infer<
  typeof recordSeatCheckoutPaidCommandDataSchema
>;
export const seatCheckoutPaidEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SEAT_CHECKOUT_PAID_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: seatCheckoutPaidEventDataSchema,
});
export type SeatCheckoutPaidEvent = z.infer<typeof seatCheckoutPaidEventSchema>;

export const RECORD_SEAT_CHECKOUTS_ABANDONED_COMMAND_TYPE =
  "lw.billing.record_seat_checkouts_abandoned" as const;
export const recordSeatCheckoutsAbandonedCommandDataSchema = seatCheckoutsAbandonedEventDataSchema;
export type RecordSeatCheckoutsAbandonedCommandData = z.infer<
  typeof recordSeatCheckoutsAbandonedCommandDataSchema
>;
export const seatCheckoutsAbandonedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE),
  version: z.literal(BILLING_LIFECYCLE_EVENT_VERSION),
  data: seatCheckoutsAbandonedEventDataSchema,
});
export type SeatCheckoutsAbandonedEvent = z.infer<typeof seatCheckoutsAbandonedEventSchema>;

export type BillingLifecycleEvent =
  | SubscriptionChangedEvent
  | SubscriptionStartedEvent
  | CheckoutCompletedEvent
  | UsageBillingChangedEvent
  | BillingAuditRecordedEvent
  | PlanLimitAlertSentEvent
  | CheckoutCurrencySelectedEvent
  | PricingModelChangedEvent
  | SeatCheckoutPaidEvent
  | SeatCheckoutsAbandonedEvent;
