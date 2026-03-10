import type { PlanInfo } from "../licensing/planInfo";
import type { LimitType } from "../../src/server/license-enforcement/types";
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

export type SubscriptionNotificationPayload =
  | ProspectiveSubscriptionNotification
  | ConfirmedSubscriptionNotification;

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
};
