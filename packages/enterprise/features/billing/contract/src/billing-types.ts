import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import type { PlanTypes } from "./plan-types";

export type UsageUnit = "traces" | "events";
export type LimitType = "members" | "membersLite";
export type SignupData = {
  usage?: string | null;
  solution?: string | null;
  terms?: boolean;
  companyType?: string | null;
  companySize?: string | null;
  projectType?: string | null;
  howDidYouHearAboutUs?: string | null;
  otherCompanyType?: string | null;
  otherProjectType?: string | null;
  otherHowDidYouHearAboutUs?: string | null;
  yourRole?: string | null;
  featureUsage?: string | null;
  leadSource?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  referrer?: string | null;
};

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
  signUpData?: SignupData | null;
};

// ---------------------------------------------------------------------------
// Usage limits
//
// Read by both usage-limit services in the server package: one decides
// whether a hard limit has been hit, the other whether an organization is
// close enough to be warned. They live here because a type declared inside
// either service would make the other import a service to reach it.
// ---------------------------------------------------------------------------

/** The counter cannot always answer; an unknown count is not a zero one. */
export const USAGE_UNKNOWN = "unknown" as const;

export interface UsageLimitData {
  organizationId: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
}

export interface BillingUsageLimitOrganization {
  findWithAdmins(organizationId: string): Promise<{
    id: string;
    name: string;
    sentPlanLimitAlert: Date | null;
    members: Array<{ user: { id: string; name: string | null; email: string | null } }>;
  } | null>;
  updateSentPlanLimitAlert(organizationId: string, timestamp: Date): Promise<void>;
  findProjectsWithName(organizationId: string): Promise<Array<{ id: string; name: string }>>;
}

export interface BillingUsageCounter {
  getCountByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<Array<{ projectId: string; count: number }> | typeof USAGE_UNKNOWN>;
}

export interface BillingPlanResolver {
  getActivePlan(input: { organizationId: string }): Promise<{ name?: string | null }>;
}
