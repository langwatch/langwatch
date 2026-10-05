/**
 * The Postgres rows and enums this feature's layers pass around, restated so
 * no port, service or transport names the generated client. Each mirrors
 * `packages/prisma-client/prisma/schema.prisma` and moves with it.
 */
import type { Instant } from "@langwatch/time";

import type { OrganizationIntent } from "./organization.ts";

/** A Json column's value, mirroring the generated client's own shape. */
export type OrganizationJsonObject = { [Key in string]?: OrganizationJsonValue };
export type OrganizationJsonArray = OrganizationJsonValue[];
export type OrganizationJsonValue =
  | string
  | number
  | boolean
  | OrganizationJsonObject
  | OrganizationJsonArray
  | null;

export const OrganizationUserRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  EXTERNAL: "EXTERNAL",
  /** A Developer seat (ADR-171): a personal project and nothing shared. */
  DEVELOPER: "DEVELOPER",
} as const;
export type OrganizationUserRole = (typeof OrganizationUserRole)[keyof typeof OrganizationUserRole];

/**
 * The audit action a Developer admission writes (ADR-171). A Full member's
 * admission reaches the audit page through the organisation-wide grant the
 * ledger attaches; a Developer gets no grant, so the row itself is audited.
 */
export const DEVELOPER_ADMISSION_AUDIT_ACTION = "organization.member.admitted";

/** The routes a Developer admission arrives by, recorded as `via` on its audit row. */
export const DEVELOPER_ADMISSION_VIA = [
  "domain-join",
  "join-request-approved",
  "sso",
  "invite",
] as const;
export type DeveloperAdmissionVia = (typeof DEVELOPER_ADMISSION_VIA)[number];

/** How a membership created without an invitation arrived, for a Developer's audit row. */
export type DeveloperAdmission = Readonly<{
  via: DeveloperAdmissionVia;
  joinRequestId?: string;
  /** The administrator who approved it; absent when a policy or a sign-in did. */
  actorUserId?: string | null;
}>;

/** The seat a membership created without an invitation lands on (ADR-171). */
export type OrganizationJoinerSeat = "MEMBER" | "DEVELOPER";

/** What creating a membership answered: whether the row is new, and its seat. */
export type OrganizationMembershipWrite = Readonly<{
  outcome: "created" | "already-present";
  seat: OrganizationJoinerSeat;
}>;

export const TeamUserRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
  /** The role a CUSTOM role binding stores, alongside the custom role's id. */
  CUSTOM: "CUSTOM",
} as const;
export type TeamUserRole = (typeof TeamUserRole)[keyof typeof TeamUserRole];

export const PricingModel = { TIERED: "TIERED", SEAT_EVENT: "SEAT_EVENT" } as const;
export type PricingModel = (typeof PricingModel)[keyof typeof PricingModel];

export const InviteStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  REVOKED: "REVOKED",
} as const;
export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];

export const OrganizationCurrency = { USD: "USD", EUR: "EUR" } as const;
export type OrganizationCurrency = (typeof OrganizationCurrency)[keyof typeof OrganizationCurrency];

export type Organization = {
  id: string;
  name: string;
  phoneNumber: string | null;
  slug: string;
  createdAt: Instant;
  updatedAt: Instant;
  usageSpendingMaxLimit: number | null;
  maxSessionDurationDays: number;
  mfaRequired: boolean;
  signupData: OrganizationJsonValue | null;
  signedDPA: boolean;
  elasticsearchNodeUrl: string | null;
  elasticsearchApiKey: string | null;
  useCustomElasticsearch: boolean;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  s3Bucket: string | null;
  useCustomS3: boolean;
  sentPlanLimitAlert: Instant | null;
  ssoDomain: string | null;
  ssoProvider: string | null;
  domainJoin: string;
  joinDomains: string[];
  presenceEnabled: boolean;
  traceSharingEnabled: boolean;
  supportContact: string | null;
  primaryIntent: OrganizationIntent | null;
  promoCode: string | null;
  stripeCustomerId: string | null;
  currency: OrganizationCurrency;
  pricingModel: PricingModel;
  license: string | null;
  licenseExpiresAt: Instant | null;
  licenseLastValidatedAt: Instant | null;
};

export type OrganizationInvite = {
  id: string;
  email: string;
  inviteCode: string;
  expiration: Instant | null;
  status: InviteStatus;
  organizationId: string;
  teamIds: string;
  teamAssignments: OrganizationJsonValue | null;
  role: OrganizationUserRole;
  requestedBy: string | null;
  subscriptionId: string | null;
  acceptedByUserId: string | null;
  acceptedViaIdentifierId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
};

export type OrganizationUser = {
  userId: string;
  organizationId: string;
  role: OrganizationUserRole;
  createdAt: Instant;
  updatedAt: Instant;
  departmentId: string | null;
  disabledAt: Instant | null;
};

export type User = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  image: string | null;
  pendingSsoSetup: boolean;
  userHashKey: string | null;
  twoFactorEnabled: boolean;
  createdAt: Instant;
  updatedAt: Instant;
  lastLoginAt: Instant | null;
  deactivatedAt: Instant | null;
  lastHomePath: string | null;
  tracesExplorerTourDismissedAt: Instant | null;
  passkeyNudgeDismissedAt: Instant | null;
};

export type Team = {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: Instant;
  updatedAt: Instant;
  archivedAt: Instant | null;
  isPersonal: boolean;
  ownerUserId: string | null;
  departmentId: string | null;
};

export type TeamUser = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  assignedRoleId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
};

export type CustomRole = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: OrganizationJsonValue;
  kind: string;
  createdAt: Instant;
  updatedAt: Instant;
};

export type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  lwqlKey: string;
  teamId: string;
  language: string;
  framework: string;
  kind: string;
  firstMessage: boolean;
  integrated: boolean;
  createdAt: Instant;
  updatedAt: Instant;
  userLinkTemplate: string | null;
  traceSharingEnabled: boolean;
  presenceEnabled: boolean;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  s3Bucket: string | null;
  archivedAt: Instant | null;
  isPersonal: boolean;
  ownerUserId: string | null;
  personalFeatures: OrganizationJsonValue;
  departmentId: string | null;
  langyEgressAllowlist: OrganizationJsonValue | null;
  lastCodingAgentSessionAt: Instant | null;
  lastCodingAgentPullRequestAt: Instant | null;
};
