import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

import { billingPricingModelSchema } from "./billing-types.ts";
import { currencySchema } from "./pricing.ts";

/** Billing's lifecycle facts, which peers react to from their own side (§9). */
export const BILLING_LIFECYCLE_PIPELINE_NAME = "billing_lifecycle" as const;
export const BILLING_LIFECYCLE_AGGREGATE_TYPE = "billing_lifecycle" as const;
export const SUBSCRIPTION_CHANGED_EVENT_TYPE = "lw.billing.subscription_changed" as const;
export const SUBSCRIPTION_STARTED_EVENT_TYPE = "lw.billing.subscription_started" as const;
export const CHECKOUT_COMPLETED_EVENT_TYPE = "lw.billing.checkout_completed" as const;
export const USAGE_BILLING_CHANGED_EVENT_TYPE = "lw.billing.usage_billing_changed" as const;
export const BILLING_AUDIT_RECORDED_EVENT_TYPE = "lw.billing.audit_recorded" as const;
export const PLAN_LIMIT_ALERT_SENT_EVENT_TYPE = "lw.billing.plan_limit_alert_sent" as const;
export const CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE =
  "lw.billing.checkout_currency_selected" as const;
export const PRICING_MODEL_CHANGED_EVENT_TYPE = "lw.billing.pricing_model_changed" as const;
export const SEAT_CHECKOUT_PAID_EVENT_TYPE = "lw.billing.seat_checkout_paid" as const;
export const SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE = "lw.billing.seat_checkouts_abandoned" as const;
export const BILLING_LIFECYCLE_EVENT_VERSION = "2026-09-30" as const;

/** An organization gained or lost its subscription, with the members who carry the fact. */
const subscriptionChangedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  memberUserIds: z.array(z.string().min(1)),
  hasSubscription: z.boolean(),
});
export interface SubscriptionChangedEventDataSchema extends Named<
  typeof subscriptionChangedEventDataSchemaDefinition
> {}
export const subscriptionChangedEventDataSchema: SubscriptionChangedEventDataSchema =
  subscriptionChangedEventDataSchemaDefinition;
export type SubscriptionChangedEventData = z.infer<typeof subscriptionChangedEventDataSchema>;

/** A subscription that was not active became active on a plan; a renewal records none. */
const subscriptionStartedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  subscriptionId: z.string().min(1),
  plan: z.string().min(1),
  memberUserIds: z.array(z.string().min(1)),
});
export interface SubscriptionStartedEventDataSchema extends Named<
  typeof subscriptionStartedEventDataSchemaDefinition
> {}
export const subscriptionStartedEventDataSchema: SubscriptionStartedEventDataSchema =
  subscriptionStartedEventDataSchemaDefinition;
export type SubscriptionStartedEventData = z.infer<typeof subscriptionStartedEventDataSchema>;

/** A Stripe checkout for an organization's subscription completed. */
const checkoutCompletedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  subscriptionId: z.string().min(1),
  /** ISO instant the checkout session was created. */
  checkoutCreatedAt: z.string().min(1),
});
export interface CheckoutCompletedEventDataSchema extends Named<
  typeof checkoutCompletedEventDataSchemaDefinition
> {}
export const checkoutCompletedEventDataSchema: CheckoutCompletedEventDataSchema =
  checkoutCompletedEventDataSchemaDefinition;
export type CheckoutCompletedEventData = z.infer<typeof checkoutCompletedEventDataSchema>;

/**
 * Whether the meter bills an organization, as billing read it (ADR-174 decisions 12, 17). A real
 * fact is stamped after the write that changed the answer committed; a catch-up fact is stamped
 * when it read billing. Folders keep the newest stamp, and a real fact wins a tie.
 */
const usageBillingChangedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  usageBilled: z.boolean(),
  fromCatchUp: z.boolean(),
});
export interface UsageBillingChangedEventDataSchema extends Named<
  typeof usageBillingChangedEventDataSchemaDefinition
> {}
export const usageBillingChangedEventDataSchema: UsageBillingChangedEventDataSchema =
  usageBillingChangedEventDataSchemaDefinition;
export type UsageBillingChangedEventData = z.infer<typeof usageBillingChangedEventDataSchema>;

/**
 * A platform operator's billing command, recorded after it ran; audit-log writes the row from its
 * side (round 37 D3; organization-audit.events.ts shape). Spec: modules/audit-log/specs/audit-log.feature
 */
const billingAuditRecordedEventDataSchemaDefinition = z.object({
  /** The organization the command targeted, or the platform tenant for an invoice. */
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  /** An `audit` id minted once per command: a redelivered fact writes one row. */
  idempotencyKey: z.string().min(1),
  /** The operator who ran the command. */
  userId: z.string().min(1),
  action: z.string().min(1),
  args: z.json().optional(),
  targetKind: z.string().min(1),
  targetId: z.string().min(1),
});
export interface BillingAuditRecordedEventDataSchema extends Named<
  typeof billingAuditRecordedEventDataSchemaDefinition
> {}
export const billingAuditRecordedEventDataSchema: BillingAuditRecordedEventDataSchema =
  billingAuditRecordedEventDataSchemaDefinition;
export type BillingAuditRecordedEventData = z.infer<typeof billingAuditRecordedEventDataSchema>;

/**
 * Billing's writes to organisation rows, recorded as facts organization applies (R42, round 46
 * D-b). Each names the value it sets, so a redelivery sets it again and changes nothing.
 * Spec: enterprise/modules/billing/specs/billing.feature
 */
const organizationRowFactSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
});

/** Billing sent the organization's plan-limit alert at `sentAt` (epoch ms). */
const planLimitAlertSentEventDataSchemaDefinition = z.object({
  ...organizationRowFactSchema.shape,
  sentAt: z.number().int().nonnegative(),
});
export interface PlanLimitAlertSentEventDataSchema extends Named<
  typeof planLimitAlertSentEventDataSchemaDefinition
> {}
export const planLimitAlertSentEventDataSchema: PlanLimitAlertSentEventDataSchema =
  planLimitAlertSentEventDataSchemaDefinition;
export type PlanLimitAlertSentEventData = z.infer<typeof planLimitAlertSentEventDataSchema>;

/** A completed checkout chose the currency the organization is billed in. */
const checkoutCurrencySelectedEventDataSchemaDefinition = z.object({
  ...organizationRowFactSchema.shape,
  currency: currencySchema,
});
export interface CheckoutCurrencySelectedEventDataSchema extends Named<
  typeof checkoutCurrencySelectedEventDataSchemaDefinition
> {}
export const checkoutCurrencySelectedEventDataSchema: CheckoutCurrencySelectedEventDataSchema =
  checkoutCurrencySelectedEventDataSchemaDefinition;
export type CheckoutCurrencySelectedEventData = z.infer<
  typeof checkoutCurrencySelectedEventDataSchema
>;

/** The organization is now billed on `pricingModel`. */
const pricingModelChangedEventDataSchemaDefinition = z.object({
  ...organizationRowFactSchema.shape,
  pricingModel: billingPricingModelSchema,
});
export interface PricingModelChangedEventDataSchema extends Named<
  typeof pricingModelChangedEventDataSchemaDefinition
> {}
export const pricingModelChangedEventDataSchema: PricingModelChangedEventDataSchema =
  pricingModelChangedEventDataSchemaDefinition;
export type PricingModelChangedEventData = z.infer<typeof pricingModelChangedEventDataSchema>;

/** A seat checkout was paid: the invitations held for billing's subscription row open. */
const seatCheckoutPaidEventDataSchemaDefinition = z.object({
  ...organizationRowFactSchema.shape,
  subscriptionId: z.string().min(1),
});
export interface SeatCheckoutPaidEventDataSchema extends Named<
  typeof seatCheckoutPaidEventDataSchemaDefinition
> {}
export const seatCheckoutPaidEventDataSchema: SeatCheckoutPaidEventDataSchema =
  seatCheckoutPaidEventDataSchemaDefinition;
export type SeatCheckoutPaidEventData = z.infer<typeof seatCheckoutPaidEventDataSchema>;

/** Seat checkouts were abandoned: the invitations held for those subscription rows close. */
const seatCheckoutsAbandonedEventDataSchemaDefinition = z.object({
  ...organizationRowFactSchema.shape,
  subscriptionIds: z.array(z.string().min(1)).min(1),
});
export interface SeatCheckoutsAbandonedEventDataSchema extends Named<
  typeof seatCheckoutsAbandonedEventDataSchemaDefinition
> {}
export const seatCheckoutsAbandonedEventDataSchema: SeatCheckoutsAbandonedEventDataSchema =
  seatCheckoutsAbandonedEventDataSchemaDefinition;
export type SeatCheckoutsAbandonedEventData = z.infer<typeof seatCheckoutsAbandonedEventDataSchema>;
