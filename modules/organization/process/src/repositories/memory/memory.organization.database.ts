import type {
  JoinRequestJoining,
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

/** One dated member-to-department link; `validTo` is null while it is open. */
export interface MemoryDepartmentMembershipRow {
  id: string;
  organizationId: string;
  userId: string;
  departmentId: string;
  validFrom: Instant;
  validTo: Instant | null;
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
}

/** One team-scoped membership row (the `TeamUser` join table). */
export interface MemoryTeamUserRow {
  teamId: string;
  userId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
}

/** One custom role, the fields a seat's assignability check reads. */
export interface MemoryCustomRoleRow {
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
}

/** One project row, only the columns the personal workspace needs. */
export interface MemoryProjectRow {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
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
  readonly departmentMemberships: MemoryDepartmentMembershipRow[] = [];

  static create(): MemoryOrganizationDatabase {
    return new MemoryOrganizationDatabase();
  }

  private constructor() {}
}
