// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type {
  CustomRole,
  Organization,
  OrganizationIntent,
  OrganizationUser,
  OrganizationUserRole,
  PricingModel,
  PrismaClient,
  Project,
  Team,
  TeamUser,
  TeamUserRole,
  User,
} from "@prisma/client";
import type { TeamRoleUpdateOrigin } from "../compute-effective-team-role-updates";

export type TeamWithProjects = Team & {
  projects: Project[];
};

export type TeamWithProjectsAndMembers = TeamWithProjects & {
  members: (TeamUser & {
    assignedRole?: CustomRole | null;
  })[];
};

export type FullyLoadedOrganization = Organization & {
  members: OrganizationUser[];
  teams: TeamWithProjectsAndMembers[];
};

export type TeamMemberWithUser = TeamUser & {
  user: User;
  assignedRole?: CustomRole | null;
};

export type TeamMemberWithTeam = TeamUser & {
  team: Team;
  assignedRole?: CustomRole | null;
};

export type TeamWithProjectsAndMembersAndUsers = Team & {
  members: TeamMemberWithUser[];
  projects: Project[];
};

export type UserWithTeams = User & {
  teamMemberships: TeamMemberWithTeam[];
};

export type OrganizationMemberWithUser = OrganizationUser & {
  user: UserWithTeams;
};

export type OrganizationWithMembersAndTheirTeams = Organization & {
  members: OrganizationMemberWithUser[];
};

/**
 * Organization with admin members and their users, used for notification delivery.
 */
export interface OrganizationWithAdmins {
  id: string;
  name: string;
  sentPlanLimitAlert: Date | null;
  members: Array<{
    role: string;
    user: {
      id: string;
      name: string | null;
      email: string | null;
    };
  }>;
}

/**
 * Organization data needed by billing usage reporting.
 * Only returned for SEAT_EVENT pricing orgs with active GROWTH subscriptions.
 */
export interface OrganizationForBilling {
  id: string;
  stripeCustomerId: string | null;
  subscriptions: { id: string }[];
}

/**
 * Input for creating an organization and assigning the user as admin.
 */
export interface CreateAndAssignInput {
  userId: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  teamId: string;
  teamSlug: string;
  phoneNumber?: string;
  signUpData?: Record<string, unknown>;
  /** ADR-038 signup intent; undefined/null persists NULL (legacy default). */
  primaryIntent?: OrganizationIntent | null;
  pricingModel: PricingModel;
}

/**
 * Result of creating an organization and team.
 */
export interface CreateAndAssignResult {
  organization: { id: string; name: string };
  team: { id: string; slug: string; name: string };
}

/**
 * Filter parameters for fetching audit logs.
 */
export interface AuditLogFilters {
  organizationId: string;
  projectId?: string;
  userId?: string;
  pageOffset: number;
  pageSize: number;
  action?: string;
  startDate?: number;
  endDate?: number;
  /**
   * Filter by gateway-resource kind, e.g. "virtual_key" / "budget" /
   * "provider_binding" / "cache_rule". Only matches rows where the gateway
   * services populated `targetKind` — platform-shape rows have null here.
   */
  targetKind?: string;
  /**
   * Filter to a single target-resource id. Used by the VK/Budget detail
   * page deep-link pattern; pairs with `targetKind` for type safety.
   */
  targetId?: string;
}

/**
 * Enriched audit log entry with resolved user and project data.
 * Backed by a single `AuditLog` table that stores both gateway-shape
 * (targetKind + before/after diff) and platform-shape (args + metadata)
 * rows. The `source` field is computed from the presence of `targetKind`.
 */
export interface EnrichedAuditLog {
  id: string;
  createdAt: Date;
  /** Nullable to support system-actor writes (background jobs, migrations). */
  userId: string | null;
  organizationId: string | null;
  projectId: string | null;
  action: string;
  payload: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  error: string | null;
  args: unknown;
  user: { id: string; name: string | null; email: string | null } | null;
  project: { id: string; name: string } | null;
  /** Computed: gateway = `targetKind` populated, platform = otherwise. */
  source: "platform" | "gateway";
  /** Gateway resource kind — only set when source="gateway". */
  targetKind: string | null;
  /** Gateway resource id — only set when source="gateway". */
  targetId: string | null;
  /** Gateway-side diff (before state). Only set when source="gateway". */
  before: unknown;
  /** Gateway-side diff (after state). Only set when source="gateway". */
  after: unknown;
}

/**
 * Partial update for an organization's settings: only the fields present are
 * written. `undefined` leaves a column untouched; an explicit `null` (or empty
 * string, for the encrypted S3 credentials) clears it. Callers whose form
 * semantics are "absent means clear" (the organization settings form
 * round-trips every S3 field) make the clearing explicit with nulls.
 */
export interface UpdateOrganizationSettingsInput {
  organizationId: string;
  name?: string;
  supportContact?: string | null;
  presenceEnabled?: boolean;
  traceSharingEnabled?: boolean;
  primaryIntent?: OrganizationIntent | null;
  s3Endpoint?: string | null;
  s3AccessKeyId?: string | null;
  s3SecretAccessKey?: string | null;
  s3Bucket?: string | null;
}

/**
 * The organization profile as the management surface reads and writes it.
 * Deliberately excludes `ssoDomain`/`ssoProvider` (staff-backoffice-only) and
 * `s3SecretAccessKey` (write-only: never read back). The S3 endpoint and
 * access key id are returned as stored (encrypted); the service decrypts.
 */
export interface OrganizationSettings {
  id: string;
  name: string;
  slug: string;
  supportContact: string | null;
  presenceEnabled: boolean;
  traceSharingEnabled: boolean;
  primaryIntent: OrganizationIntent | null;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3Bucket: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A membership row with the user it belongs to, as the members management
 * surface lists it. `disabledAt` is exposed rather than filtered so an admin
 * can see who is disabled in order to re-enable them.
 */
export interface OrganizationMemberSummary {
  userId: string;
  organizationId: string;
  role: OrganizationUserRole;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string | null; email: string | null };
}

/**
 * One team the member reaches through a TEAM-scoped role binding. Personal
 * workspaces are excluded: they are not access an administrator granted or
 * can take away, so the management surfaces never list them.
 */
export interface MemberTeamBinding {
  teamId: string;
  teamName: string;
  role: TeamUserRole;
  customRoleId: string | null;
  customRoleName: string | null;
}

/**
 * Input for deleting a member from an organization.
 */
export interface DeleteMemberInput {
  organizationId: string;
  userId: string;
}

/**
 * Input for disabling or re-enabling a membership. Disabling revokes the
 * person's access to this organization and returns their licensed seat,
 * without touching their role, department or history.
 */
export interface SetMemberDisabledInput {
  organizationId: string;
  userId: string;
  disabled: boolean;
}

/**
 * Input for updating a member's organization role and cascading team roles.
 */
export interface UpdateMemberRoleInput {
  organizationId: string;
  userId: string;
  role: OrganizationUserRole;
  effectiveTeamRoleUpdates: Array<{
    teamId: string;
    role: string;
    customRoleId?: string;
    origin: TeamRoleUpdateOrigin;
  }>;
  currentUserId: string;
}

/**
 * What the seat change did that the admin who made it would not otherwise see.
 *
 * A correction to Viewer can take away a shared team's only team-scoped admin.
 * The change is allowed, so this is the only place it is visible.
 */
export interface UpdateMemberRoleResult {
  teamsLeftWithoutAdmin: Array<{ id: string; name: string }>;
}

/**
 * Input for updating a team member's role.
 */
export interface UpdateTeamMemberRoleInput {
  teamId: string;
  userId: string;
  role: TeamUserRole;
  customRoleId?: string;
  currentUserId: string;
}

export interface OrganizationRepository {
  getOrganizationIdByTeamId(teamId: string): Promise<string | null>;
  getUserOrgRole(params: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationUserRole | null>;
  getUserOrgRoleByTeamId(params: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null>;
  getProjectIds(organizationId: string): Promise<string[]>;
  findWithAdmins(
    organizationId: string,
  ): Promise<OrganizationWithAdmins | null>;
  updateSentPlanLimitAlert(
    organizationId: string,
    timestamp: Date,
  ): Promise<void>;
  findProjectsWithName(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>>;
  clearTrialLicense(organizationId: string): Promise<void>;
  updateCurrency(input: {
    organizationId: string;
    currency: string;
  }): Promise<void>;
  getPricingModel(organizationId: string): Promise<string | null>;
  getStripeCustomerId(organizationId: string): Promise<string | null>;
  findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<{ id: string } | null>;
  findNameById(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null>;
  findPrimaryIntentById(
    organizationId: string,
  ): Promise<OrganizationIntent | null>;
  getOrganizationForBilling(
    organizationId: string,
  ): Promise<OrganizationForBilling | null>;

  // --- New methods for router delegation ---

  createAndAssign(input: CreateAndAssignInput): Promise<CreateAndAssignResult>;

  getAllForUser(params: {
    userId: string;
    isDemo: boolean;
    demoProjectUserId: string;
    demoProjectId: string;
  }): Promise<FullyLoadedOrganization[]>;

  getOrganizationWithMembers(params: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null>;

  getMemberById(params: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null>;

  getAllMembers(organizationId: string): Promise<User[]>;

  /**
   * A single membership row with its user, disabled or not. Unlike
   * `getMemberById` there is no caller pre-check: the management surface
   * authenticates through the organization credential, not a session user.
   */
  findMembership(params: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationMemberSummary | null>;

  /** Paginated membership list for the management surface. */
  listMembers(params: {
    organizationId: string;
    includeDisabled: boolean;
    offset: number;
    limit: number;
  }): Promise<{ members: OrganizationMemberSummary[]; totalCount: number }>;

  /**
   * The member's TEAM-scoped role bindings with team names, personal
   * workspaces excluded.
   */
  findMemberTeamBindings(params: {
    organizationId: string;
    userId: string;
  }): Promise<MemberTeamBinding[]>;

  /** The organization profile the management surface reads back. */
  findSettingsById(
    organizationId: string,
  ): Promise<OrganizationSettings | null>;

  /** Partial settings update; see {@link UpdateOrganizationSettingsInput}. */
  updateSettings(input: UpdateOrganizationSettingsInput): Promise<void>;

  deleteMember(input: DeleteMemberInput): Promise<void>;

  setMemberDisabled(input: SetMemberDisabledInput): Promise<void>;

  /**
   * The raw Prisma client behind this repository, when it has one.
   *
   * The member-role orchestration in `OrganizationService` composes helpers
   * that operate on a raw client (the personal-team guard, shared-team
   * enumeration, the license-enforcement repository). Exposing the client
   * here keeps those flows constructible from the repository alone, so every
   * existing `new OrganizationService(repo, tags)` call site keeps working.
   * Optional on purpose: the null repository has no client, and callers must
   * treat its absence as "this operation is unavailable".
   */
  getClient?(): PrismaClient;

  updateMemberRole(
    input: UpdateMemberRoleInput,
  ): Promise<UpdateMemberRoleResult>;

  updateTeamMemberRole(input: UpdateTeamMemberRoleInput): Promise<void>;

  getAuditLogs(
    filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }>;
}

export class NullOrganizationRepository implements OrganizationRepository {
  async getOrganizationIdByTeamId(_teamId: string): Promise<string | null> {
    return null;
  }

  async getUserOrgRole(_params: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationUserRole | null> {
    return null;
  }

  async getUserOrgRoleByTeamId(_params: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    return null;
  }

  async getProjectIds(_organizationId: string): Promise<string[]> {
    return [];
  }

  async findWithAdmins(
    _organizationId: string,
  ): Promise<OrganizationWithAdmins | null> {
    return null;
  }

  async updateSentPlanLimitAlert(
    _organizationId: string,
    _timestamp: Date,
  ): Promise<void> {
    // no-op
  }

  async findProjectsWithName(
    _organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return [];
  }

  async clearTrialLicense(_organizationId: string): Promise<void> {}

  async updateCurrency(_input: {
    organizationId: string;
    currency: string;
  }): Promise<void> {}

  async getPricingModel(_organizationId: string): Promise<string | null> {
    return null;
  }

  async getStripeCustomerId(_organizationId: string): Promise<string | null> {
    return null;
  }

  async findByStripeCustomerId(
    _stripeCustomerId: string,
  ): Promise<{ id: string } | null> {
    return null;
  }

  async findNameById(
    _organizationId: string,
  ): Promise<{ id: string; name: string } | null> {
    return null;
  }

  async findPrimaryIntentById(
    _organizationId: string,
  ): Promise<OrganizationIntent | null> {
    return null;
  }

  async getOrganizationForBilling(
    _organizationId: string,
  ): Promise<OrganizationForBilling | null> {
    return null;
  }

  async createAndAssign(
    _input: CreateAndAssignInput,
  ): Promise<CreateAndAssignResult> {
    return {
      organization: { id: "", name: "" },
      team: { id: "", slug: "", name: "" },
    };
  }

  async getAllForUser(_params: {
    userId: string;
    isDemo: boolean;
    demoProjectUserId: string;
    demoProjectId: string;
  }): Promise<FullyLoadedOrganization[]> {
    return [];
  }

  async getOrganizationWithMembers(_params: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null> {
    return null;
  }

  async getMemberById(_params: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null> {
    return null;
  }

  async getAllMembers(_organizationId: string): Promise<User[]> {
    return [];
  }

  async findMembership(_params: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationMemberSummary | null> {
    return null;
  }

  async listMembers(_params: {
    organizationId: string;
    includeDisabled: boolean;
    offset: number;
    limit: number;
  }): Promise<{ members: OrganizationMemberSummary[]; totalCount: number }> {
    return { members: [], totalCount: 0 };
  }

  async findMemberTeamBindings(_params: {
    organizationId: string;
    userId: string;
  }): Promise<MemberTeamBinding[]> {
    return [];
  }

  async findSettingsById(
    _organizationId: string,
  ): Promise<OrganizationSettings | null> {
    return null;
  }

  async updateSettings(
    _input: UpdateOrganizationSettingsInput,
  ): Promise<void> {}

  async deleteMember(_input: DeleteMemberInput): Promise<void> {}

  async setMemberDisabled(_input: SetMemberDisabledInput): Promise<void> {}

  async updateMemberRole(
    _input: UpdateMemberRoleInput,
  ): Promise<UpdateMemberRoleResult> {
    return { teamsLeftWithoutAdmin: [] };
  }

  async updateTeamMemberRole(
    _input: UpdateTeamMemberRoleInput,
  ): Promise<void> {}

  async getAuditLogs(
    _filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    return { auditLogs: [], totalCount: 0 };
  }
}
