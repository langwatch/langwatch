import type {
  CustomRole,
  Organization,
  OrganizationUser,
  OrganizationUserRole,
  PricingModel,
  Project,
  Team,
  TeamUser,
  TeamUserRole,
  User,
} from "@prisma/client";
import type { OrganizationFeatureName } from "../organization.service";

export type TeamWithProjects = Team & {
  projects: Project[];
};

export type TeamWithProjectsAndMembers = TeamWithProjects & {
  members: (TeamUser & {
    assignedRole?: CustomRole | null;
  })[];
};

export type OrganizationFeature = {
  feature: string;
  trialEndDate: Date | null;
};

export type FullyLoadedOrganization = Organization & {
  members: OrganizationUser[];
  teams: TeamWithProjectsAndMembers[];
  features: OrganizationFeature[];
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

export interface OrganizationFeatureRow {
  feature: string;
  organizationId: string;
  trialEndDate: Date | null;
}

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
}

/**
 * Enriched audit log entry with resolved user and project data.
 */
export interface EnrichedAuditLog {
  id: string;
  createdAt: Date;
  userId: string;
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
}

/**
 * Input for updating an organization's settings.
 */
export interface UpdateOrganizationInput {
  organizationId: string;
  name: string;
  s3Endpoint?: string | null;
  s3AccessKeyId?: string | null;
  s3SecretAccessKey?: string | null;
  elasticsearchNodeUrl?: string | null;
  elasticsearchApiKey?: string | null;
  s3Bucket?: string | null;
}

/**
 * Input for deleting a member from an organization.
 */
export interface DeleteMemberInput {
  organizationId: string;
  userId: string;
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
  }>;
  currentUserId: string;
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
  getProjectIds(organizationId: string): Promise<string[]>;
  getFeature(
    organizationId: string,
    feature: OrganizationFeatureName,
  ): Promise<OrganizationFeatureRow | null>;
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
  findNameById(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null>;
  getOrganizationForBilling(
    organizationId: string,
  ): Promise<OrganizationForBilling | null>;

  // --- New methods for router delegation ---

  createAndAssign(
    input: CreateAndAssignInput,
  ): Promise<CreateAndAssignResult>;

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

  update(input: UpdateOrganizationInput): Promise<void>;

  deleteMember(input: DeleteMemberInput): Promise<void>;

  updateMemberRole(input: UpdateMemberRoleInput): Promise<void>;

  updateTeamMemberRole(input: UpdateTeamMemberRoleInput): Promise<void>;

  getAuditLogs(
    filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }>;
}

export class NullOrganizationRepository implements OrganizationRepository {
  async getOrganizationIdByTeamId(_teamId: string): Promise<string | null> {
    return null;
  }

  async getProjectIds(_organizationId: string): Promise<string[]> {
    return [];
  }

  async getFeature(
    _organizationId: string,
    _feature: OrganizationFeatureName,
  ): Promise<OrganizationFeatureRow | null> {
    return null;
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

  async findNameById(
    _organizationId: string,
  ): Promise<{ id: string; name: string } | null> {
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

  async update(_input: UpdateOrganizationInput): Promise<void> {}

  async deleteMember(_input: DeleteMemberInput): Promise<void> {}

  async updateMemberRole(_input: UpdateMemberRoleInput): Promise<void> {}

  async updateTeamMemberRole(
    _input: UpdateTeamMemberRoleInput,
  ): Promise<void> {}

  async getAuditLogs(
    _filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    return { auditLogs: [], totalCount: 0 };
  }
}
