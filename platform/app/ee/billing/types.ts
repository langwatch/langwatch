import type { z } from "zod";
import type { UsageUnit } from "../../src/server/app-layer/usage/usage-meter-policy";
import type { LimitType } from "../../src/server/license-enforcement/types";
import type { signUpDataSchema } from "../../src/server/schemas/sign-up-data.schema";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import type { PlanTypes } from "./planTypes";

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
  /** Counting unit the plan cap is measured in. */
  usageUnit: UsageUnit;
  /** Usage counted so far this month, in `usageUnit`. */
  current: number;
  /** Monthly cap allowed by the plan, in `usageUnit`. */
  max: number;
};

export type PlanLimitNotificationContext = {
  organizationId: string;
  organizationName: string;
  adminName?: string;
  adminEmail?: string;
  planName: string;
  /** Display label for the cap that was hit, for example "Monthly Traces". */
  limitType: string;
  current: number;
  max: number;
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

export type SubscriptionNotificationPayload =
  | ProspectiveSubscriptionNotification
  | ConfirmedSubscriptionNotification
  | CancelledSubscriptionNotification;

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
