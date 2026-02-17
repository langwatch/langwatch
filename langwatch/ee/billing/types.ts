import type { PlanInfo } from "../licensing/planInfo";
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

export type PlanLimitNotificationHandlers = {
  sendSlackNotification?: (
    context: PlanLimitNotificationContext,
  ) => Promise<void> | void;
  sendHubspotNotification?: (
    context: PlanLimitNotificationContext,
  ) => Promise<void> | void;
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

export type BillingNotificationHandlers = PlanLimitNotificationHandlers & {
  sendSubscriptionNotification?: (
    payload: SubscriptionNotificationPayload,
  ) => Promise<void> | void;
};
