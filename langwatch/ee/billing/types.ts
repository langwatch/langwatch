import type { z } from "zod";
import type { PlanInfo } from "../licensing/planInfo";
import type { LimitType } from "../../src/server/license-enforcement/types";
import type { PlanTypes } from "./planTypes";
import type { signUpDataSchema } from "../../src/server/schemas/sign-up-data.schema";

export type BillingPlanProvider = {
  getActivePlan(
    organizationId: string,
    user?: {
      id?: string;
      email?: string | null;
      name?: string | null;
      impersonator?: {
        email?: string | null;
      };
    },
  ): Promise<PlanInfo>;
};

export type PlanLimitNotifierInput = {
  organizationId: string;
  planName: string;
};

export type PlanLimitNotificationContext = {
  organizationId: string;
  organizationName: string;
  adminName?: string;
  adminEmail?: string;
  planName: string;
};

type SubscriptionPlan = PlanTypes | (string & {});

type SubscriptionNotificationBase = {
  organizationId: string;
  organizationName: string;
  plan: SubscriptionPlan;
};

type ProspectiveSubscriptionNotification = SubscriptionNotificationBase & {
  type: "prospective";
  customerName?: string;
  customerEmail?: string;
  note?: string;
  actorEmail?: string;
};

type ConfirmedSubscriptionNotification = SubscriptionNotificationBase & {
  type: "confirmed";
  subscriptionId: string;
  startDate?: Date | null;
  maxMembers?: number | null;
  maxMessagesPerMonth?: number | null;
};

type CancelledSubscriptionNotification = SubscriptionNotificationBase & {
  type: "cancelled";
  subscriptionId: string;
  cancellationDate?: Date | null;
};

/**
 * Where a payment failure sits relative to earlier recorded failures,
 * resolved by the webhook service (domain knowledge — the Slack builder
 * only renders it):
 * - `no-prior-failure`: nothing recorded before this event (the date resets
 *   on successful payment, so this is not necessarily the first failure ever)
 * - `same-invoice-retry`: a failure was already recorded during this
 *   invoice's dunning cycle; the attempt count carries the retry signal
 * - `earlier-cycle`: the previous recorded failure predates this invoice's
 *   creation, i.e. it carried over from an earlier dunning cycle
 */
export type PaymentFailurePrior =
  | { kind: "no-prior-failure" }
  | { kind: "same-invoice-retry" }
  | { kind: "earlier-cycle"; at: Date };

/**
 * Internal ops alert for a failed Stripe invoice charge. One alert per
 * `invoice.payment_failed` event is sent (no dedup) — Stripe fires one per
 * retry attempt and retries of the same invoice can be days apart, so
 * elapsed time alone cannot tell a retry from a new failure. The retry
 * signal instead comes from the invoice itself: `attemptCount` says which
 * attempt this is, and `priorFailure` classifies any previously recorded
 * failure against the invoice's creation date.
 */
type PaymentFailedSubscriptionNotification = SubscriptionNotificationBase & {
  type: "payment_failed";
  subscriptionId: string;
  stripeSubscriptionId: string;
  livemode: boolean;
  amountDue?: { cents: number; currency: string } | null;
  attemptCount?: number | null;
  priorFailure: PaymentFailurePrior;
};

export type SubscriptionNotificationPayload =
  | ProspectiveSubscriptionNotification
  | ConfirmedSubscriptionNotification
  | CancelledSubscriptionNotification
  | PaymentFailedSubscriptionNotification;

export type ResourceLimitNotificationContext = {
  organizationId: string;
  organizationName: string;
  adminName?: string;
  adminEmail?: string;
  planName: string;
  limitType: string;
  current: number;
  max: number;
};

export type ResourceLimitNotifierInput = {
  organizationId: string;
  limitType: LimitType;
  current: number;
  max: number;
};

export type LicensePurchaseNotificationPayload = {
  buyerEmail: string;
  planType: string;
  seats: number;
  amountPaid: number;
  currency: string;
};

export type SignupNotificationPayload = {
  userName?: string | null;
  userEmail?: string | null;
  organizationName?: string | null;
  phoneNumber?: string | null;
  utmCampaign?: string | null;
  signUpData?: z.infer<typeof signUpDataSchema> | null;
};
