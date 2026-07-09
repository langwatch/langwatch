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
 * Internal ops alert for a failed Stripe invoice charge. One alert per
 * `invoice.payment_failed` event is sent (no dedup) — Stripe fires one per
 * retry attempt and retries of the same invoice can be days apart, so
 * elapsed time alone cannot tell a retry from a new failure. The retry
 * signal instead comes from the invoice itself: `attemptCount` says which
 * attempt this is, and `previousFailureAt` predating `invoiceCreatedAt`
 * marks a failure carried over from an earlier dunning cycle.
 */
type PaymentFailedSubscriptionNotification = SubscriptionNotificationBase & {
  type: "payment_failed";
  dbSubscriptionId: string;
  stripeSubscriptionId: string;
  livemode: boolean;
  amountDueCents?: number | null;
  currency?: string | null;
  attemptCount?: number | null;
  previousFailureAt?: Date | null;
  invoiceCreatedAt?: Date | null;
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
