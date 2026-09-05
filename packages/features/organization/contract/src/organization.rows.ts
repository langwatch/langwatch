/**
 * The Postgres rows and enums this feature's layers pass around, restated so
 * no port, service or transport names the generated client. Each mirrors
 * `packages/prisma-client/prisma/schema.prisma` and moves with it.
 */
import type { OrganizationIntent } from "./organization";

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
} as const;
export type OrganizationUserRole = (typeof OrganizationUserRole)[keyof typeof OrganizationUserRole];

export const TeamUserRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
  /** The role a CUSTOM role binding stores, alongside the custom role's id. */
  CUSTOM: "CUSTOM",
} as const;
export type TeamUserRole = (typeof TeamUserRole)[keyof typeof TeamUserRole];

export const RoleBindingScopeType = {
  ORGANIZATION: "ORGANIZATION",
  TEAM: "TEAM",
  PROJECT: "PROJECT",
} as const;
export type RoleBindingScopeType =
  (typeof RoleBindingScopeType)[keyof typeof RoleBindingScopeType];

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
export type OrganizationCurrency =
  (typeof OrganizationCurrency)[keyof typeof OrganizationCurrency];

export type Organization = {
  id: string;
  name: string;
  phoneNumber: string | null;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
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
  sentPlanLimitAlert: Date | null;
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
  licenseExpiresAt: Date | null;
  licenseLastValidatedAt: Date | null;
};

export type OrganizationInvite = {
  id: string;
  email: string;
  inviteCode: string;
  expiration: Date | null;
  status: InviteStatus;
  organizationId: string;
  teamIds: string;
  teamAssignments: OrganizationJsonValue | null;
  role: OrganizationUserRole;
  requestedBy: string | null;
  subscriptionId: string | null;
  acceptedByUserId: string | null;
  acceptedViaIdentifierId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrganizationUser = {
  userId: string;
  organizationId: string;
  role: OrganizationUserRole;
  createdAt: Date;
  updatedAt: Date;
  departmentId: string | null;
  disabledAt: Date | null;
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
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  deactivatedAt: Date | null;
  lastHomePath: string | null;
  tracesExplorerTourDismissedAt: Date | null;
  passkeyNudgeDismissedAt: Date | null;
};

export type Team = {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  isPersonal: boolean;
  ownerUserId: string | null;
  departmentId: string | null;
};

export type TeamUser = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  assignedRoleId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomRole = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: OrganizationJsonValue;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
  userLinkTemplate: string | null;
  traceSharingEnabled: boolean;
  presenceEnabled: boolean;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  s3Bucket: string | null;
  archivedAt: Date | null;
  isPersonal: boolean;
  ownerUserId: string | null;
  personalFeatures: OrganizationJsonValue;
  departmentId: string | null;
  langyEgressAllowlist: OrganizationJsonValue | null;
  lastCodingAgentSessionAt: Date | null;
  lastCodingAgentPullRequestAt: Date | null;
};
