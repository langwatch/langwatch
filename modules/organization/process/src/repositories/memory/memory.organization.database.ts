import type {
  InviteStatus,
  JoinRequestJoining,
  Organization,
  OrganizationJsonValue,
  OrganizationIntent,
  OrganizationUserRole,
  PersonalFeatures,
  TeamUserRole,
} from "@langwatch/organization-contract";
import type { Instant } from "@langwatch/time";

/** One organization row, the fields the organization repository owns. */
export interface MemoryOrganizationRow {
  id: string;
  name: string;
  slug: string;
  supportContact: string | null;
  presenceEnabled: boolean;
  traceSharingEnabled: boolean;
  primaryIntent: OrganizationIntent | null;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  s3Bucket: string | null;
  stripeCustomerId: string | null;
  sentPlanLimitAlert?: Instant | null;
  /** Every sign-up answer the organization carries, guided onboarding among
   *  them. Shapeless here for the reason it is shapeless in Postgres. */
  signupData?: Record<string, unknown> | null;
  /** How colleagues on a matching domain get in; absent reads as asking. */
  domainJoin?: JoinRequestJoining["domainJoin"];
  joinDomains?: string[];
  /** The seat a joiner without an invitation lands on (ADR-171); absent reads as MEMBER. */
  joinerRole?: "MEMBER" | "DEVELOPER";
  /** The CLI/device session ceiling in days; absent reads as unbounded. */
  maxSessionDurationDays?: number;
  /** The organization's own Instant Evals consent; absent reads as not given. */
  instantEvalsEnabledAt?: Instant | null;
  instantEvalsEnabledByUserId?: string | null;
  createdAt: Instant;
  updatedAt: Instant;
}

/** One team row, personal or shared. */
export interface MemoryTeamRow {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  archivedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
  departmentId?: string | null;
}

/** One organization-level membership row. */
export interface MemoryOrganizationUserRow {
  userId: string;
  organizationId: string;
  role: OrganizationUserRole;
  disabledAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
  /** The grant intent an unfinished automatic admission is resumed from. */
  pendingSsoGrantId?: string | null;
  departmentId?: string | null;
}

/** One person, the fields the membership repository joins against. */
export interface MemoryUserRow {
  id: string;
  name: string | null;
  email: string | null;
  deactivatedAt: Instant | null;
  /** The legacy verified-email flag; absent reads as unverified. */
  emailVerified?: boolean;
}

/** One invitation row, every column the invite repository reads or writes. */
export interface MemoryOrganizationInviteRow {
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
}

/** One team-scoped membership row (the `TeamUser` join table). */
interface MemoryTeamUserRow {
  teamId: string;
  userId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
}

/** One custom role, the fields a seat's assignability check reads. */
interface MemoryCustomRoleRow {
  id: string;
  organizationId: string;
  name: string;
  kind: string;
  permissions: unknown;
}

/** One audit-trail entry, platform or gateway shaped (ADR consolidated). */
export interface MemoryAuditLogRow {
  id: string;
  createdAt: Instant;
  userId: string | null;
  organizationId: string | null;
  projectId: string | null;
  action: string;
  payload: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  error: string | null;
  args: unknown;
  targetKind: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  /** Who really acted, where that is not `userId`; absent reads as nobody else. */
  actorUserId?: string | null;
  metadata?: unknown;
}

/** One project row, only the columns the personal workspace needs. */
interface MemoryProjectRow {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  /** The stored LangWatchQL key; absent reads as none. */
  lwqlKey?: string;
  teamId: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  organizationId: string | null;
  archivedAt: Instant | null;
  createdAt: Instant;
  personalFeatures: PersonalFeatures | null;
}

/** One group row, its membership held as a plain set of user ids. */
export interface MemoryGroupRow {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  externalId: string | null;
  scimSource: string | null;
  memberIds: Set<string>;
  createdAt: Instant;
  updatedAt: Instant;
}

/** The contract's organization over a memory row, every column the row lacks at its default. */
export function organizationOfRow(row: MemoryOrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    phoneNumber: null,
    slug: row.slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usageSpendingMaxLimit: null,
    maxSessionDurationDays: 30,
    mfaRequired: false,
    signupData: null,
    signedDPA: false,
    elasticsearchNodeUrl: null,
    elasticsearchApiKey: null,
    useCustomElasticsearch: false,
    s3Endpoint: row.s3Endpoint,
    s3AccessKeyId: row.s3AccessKeyId,
    s3SecretAccessKey: row.s3SecretAccessKey,
    s3Bucket: row.s3Bucket,
    useCustomS3: false,
    sentPlanLimitAlert: null,
    ssoDomain: null,
    ssoProvider: null,
    domainJoin: "invite_only",
    joinDomains: [],
    presenceEnabled: row.presenceEnabled,
    traceSharingEnabled: row.traceSharingEnabled,
    supportContact: row.supportContact,
    primaryIntent: row.primaryIntent,
    promoCode: null,
    stripeCustomerId: row.stripeCustomerId,
    currency: "USD",
    pricingModel: "SEAT_EVENT",
    license: null,
    licenseExpiresAt: null,
    licenseLastValidatedAt: null,
  };
}

/**
 * The rows the organization, team and group memory repositories share — one
 * instance per boot, the way `MemoryProjectDatabase` shares tables across the
 * project module's repositories.
 */
export class MemoryOrganizationDatabase {
  readonly organizations = new Map<string, MemoryOrganizationRow>();
  /** Organizations marked as a self-hosted licence customer. */
  readonly selfHostedCustomers = new Set<string>();
  readonly teams = new Map<string, MemoryTeamRow>();
  readonly organizationUsers: MemoryOrganizationUserRow[] = [];
  readonly projects = new Map<string, MemoryProjectRow>();
  readonly groups = new Map<string, MemoryGroupRow>();
  readonly users = new Map<string, MemoryUserRow>();
  readonly teamUsers: MemoryTeamUserRow[] = [];
  readonly customRoles = new Map<string, MemoryCustomRoleRow>();
  readonly auditLogs: MemoryAuditLogRow[] = [];
  readonly invites = new Map<string, MemoryOrganizationInviteRow>();

  static create(): MemoryOrganizationDatabase {
    return new MemoryOrganizationDatabase();
  }

  private constructor() {}
}
