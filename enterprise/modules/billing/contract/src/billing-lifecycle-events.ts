// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/** Billing's lifecycle facts, which peers react to from their own side (§9). */
export const BILLING_LIFECYCLE_PIPELINE_NAME = "billing_lifecycle" as const;
export const BILLING_LIFECYCLE_AGGREGATE_TYPE = "billing_lifecycle" as const;
export const SUBSCRIPTION_CHANGED_EVENT_TYPE = "lw.billing.subscription_changed" as const;
export const CHECKOUT_COMPLETED_EVENT_TYPE = "lw.billing.checkout_completed" as const;
export const BILLING_LIFECYCLE_EVENT_VERSION = "2026-09-30" as const;

/** An organization gained or lost its subscription, with the members who carry the fact. */
export const subscriptionChangedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  memberUserIds: z.array(z.string().min(1)),
  hasSubscription: z.boolean(),
  /** The plan of the subscription that just became active; absent for any other change. */
  startedPlan: z.string().nullish(),
});
export type SubscriptionChangedEventData = z.infer<typeof subscriptionChangedEventDataSchema>;

/** A Stripe checkout for an organization's subscription completed. */
export const checkoutCompletedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  subscriptionId: z.string().min(1),
  /** ISO instant the checkout session was created. */
  checkoutCreatedAt: z.string().min(1),
});
export type CheckoutCompletedEventData = z.infer<typeof checkoutCompletedEventDataSchema>;
