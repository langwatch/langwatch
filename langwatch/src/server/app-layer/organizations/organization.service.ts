import { PricingModel, RoleBindingScopeType, type OrganizationUserRole, type TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { generate } from "@langwatch/ksuid";
import { slugify } from "~/utils/slugify";
import { KSUID_RESOURCES } from "~/utils/constants";
import { type TeamRoleValue } from "~/utils/memberRoleConstraints";
import { computeEffectiveTeamRoleUpdates } from "./compute-effective-team-role-updates";
import { isCustomRole } from "../../api/enterprise";
import type {
  AuditLogFilters,
  CreateAndAssignResult,
  EnrichedAuditLog,
  FullyLoadedOrganization,
  OrganizationForBilling,
  OrganizationMemberWithUser,
  OrganizationRepository,
  OrganizationWithAdmins,
  OrganizationWithMembersAndTheirTeams,
  UpdateMemberRoleInput,
  UpdateOrganizationInput,
  UpdateTeamMemberRoleInput,
} from "./repositories/organization.repository";
import type { User } from "@prisma/client";
import { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import type { RoleBindingForSynthesis } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";

/**
 * Pure function that returns a team enriched with a synthesized member entry
 * for the given user if they have a RoleBinding for this team or one of its
 * projects but no TeamUser row yet.
 *
 * This is intentionally a standalone function — NOT a method on
 * `OrganizationService` — because the service instance is wrapped with the
 * `traced()` proxy (see `app-layer/tracing.ts`) which turns every method call
 * into an async call that returns a Promise. Callers expecting a synchronous
 * return value would silently get a Promise with `members === undefined`,
 * causing team membership enrichment to fail invisibly.
 */
export function enrichTeamWithRoleBindings<
  T extends { members: any[]; id: string; projects: { id: string }[] },
>(
  team: T,
  userId: string,
  userRoleBindings: RoleBindingForSynthesis[],
  organizationId: string,
): T {
  const teamProjectIds = new Set(team.projects.map((p) => p.id));
  // TEAM scope takes precedence over PROJECT scope so the synthesized role is
  // deterministic when a user has both kinds of binding for the same team.
  const teamBinding = userRoleBindings.find(
    (b) =>
      b.organizationId === organizationId &&
      b.scopeType === RoleBindingScopeType.TEAM &&
      b.scopeId === team.id,
  );
  const projectBinding = teamBinding
    ? undefined
    : userRoleBindings.find(
        (b) =>
          b.organizationId === organizationId &&
          b.scopeType === RoleBindingScopeType.PROJECT &&
          teamProjectIds.has(b.scopeId),
      );
  const binding = teamBinding ?? projectBinding;
  if (!binding) return team;

  const bindingMember = {
    userId,
    teamId: team.id,
    role: binding.role,
    assignedRoleId: binding.customRoleId ?? null,
    assignedRole: binding.customRole ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const existingIndex = team.members.findIndex(
    (m: { userId: string }) => m.userId === userId,
  );
  const newMembers =
    existingIndex >= 0
      ? team.members.map((m: unknown, i: number) =>
          i === existingIndex ? bindingMember : m,
        )
      : [...team.members, bindingMember];
  return { ...team, members: newMembers };
}

export type OrganizationFeatureName = "billable_events_usage";

/**
 * Organization-level queries and mutations delegated from the tRPC router.
 * License checks remain in the router layer (they require request-scoped user context).
 */
export class OrganizationService {
  constructor(
    private readonly repo: OrganizationRepository,
    private readonly promptTagRepo: PromptTagRepository,
  ) {}

  async getOrganizationIdByTeamId(teamId: string): Promise<string | null> {
    return this.repo.getOrganizationIdByTeamId(teamId);
  }

  async getProjectIds(organizationId: string): Promise<string[]> {
    return this.repo.getProjectIds(organizationId);
  }

  async isFeatureEnabled(
    organizationId: string,
    feature: OrganizationFeatureName,
  ): Promise<boolean> {
    const row = await this.repo.getFeature(organizationId, feature);
    if (!row) return false;
    if (row.trialEndDate && new Date(row.trialEndDate) <= new Date()) {
      return false;
    }
    return true;
  }

  async findWithAdmins(
    organizationId: string,
  ): Promise<OrganizationWithAdmins | null> {
    return this.repo.findWithAdmins(organizationId);
  }

  async updateSentPlanLimitAlert(
    organizationId: string,
    timestamp: Date,
  ): Promise<void> {
    return this.repo.updateSentPlanLimitAlert(organizationId, timestamp);
  }

  async findProjectsWithName(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.repo.findProjectsWithName(organizationId);
  }

  async getOrganizationForBilling(
    organizationId: string,
  ): Promise<OrganizationForBilling | null> {
    return this.repo.getOrganizationForBilling(organizationId);
  }

  /**
   * Creates an organization with a default team and assigns the given user as admin.
   * The repository handles the transaction atomically (unit-of-work pattern).
   */
  async createAndAssign(params: {
    userId: string;
    orgName?: string;
    phoneNumber?: string;
    signUpData?: Record<string, unknown>;
    userDisplayName?: string | null;
  }): Promise<CreateAndAssignResult> {
    const orgName =
      params.orgName ?? params.userDisplayName ?? "My Organization";
    const orgId = generate(KSUID_RESOURCES.ORGANIZATION).toString();
    const orgSlug =
      slugify(orgName, { lower: true, strict: true }) +
      "-" +
      orgId.substring(orgId.length - 6);

    const teamId = generate(KSUID_RESOURCES.TEAM).toString();
    const teamSlug =
      slugify(orgName, { lower: true, strict: true }) +
      "-" +
      teamId.substring(teamId.length - 6);

    const result = await this.repo.createAndAssign({
      userId: params.userId,
      orgId,
      orgName,
      orgSlug,
      teamId,
      teamSlug,
      phoneNumber: params.phoneNumber,
      signUpData: params.signUpData,
      pricingModel: PricingModel.SEAT_EVENT,
    });

    await this.promptTagRepo.seedForOrg({
      organizationId: result.organization.id,
    });

    return result;
  }

  /**
   * Returns fully loaded organizations for a user. Returns raw (encrypted) records;
   * the router applies decryption before sending to the client.
   */
  async getAllForUser(params: {
    userId: string;
    isDemo: boolean;
    demoProjectUserId: string;
    demoProjectId: string;
  }): Promise<FullyLoadedOrganization[]> {
    return this.repo.getAllForUser(params);
  }

  /**
   * Returns an organization with its members and their team memberships.
   * Returns null when the user is not a member of the organization.
   */
  async getOrganizationWithMembers(params: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null> {
    return this.repo.getOrganizationWithMembers(params);
  }

  /**
   * Returns a single organization member by userId, verifying the current user's access.
   * Returns null when the current user is not a member (not found) or the target member
   * does not exist.
   */
  async getMemberById(params: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null> {
    return this.repo.getMemberById(params);
  }

  /**
   * Returns all active (non-deactivated) users in an organization.
   */
  async getAllMembers(organizationId: string): Promise<User[]> {
    return this.repo.getAllMembers(organizationId);
  }

  /**
   * Persists updated organization settings. Encryption is applied in the repository.
   * The router triggers elasticsearch migration after calling this method.
   */
  async update(input: UpdateOrganizationInput): Promise<void> {
    return this.repo.update(input);
  }

  /**
   * Removes a user from an organization and all its teams atomically.
   * Self-deletion guard is enforced by the router before calling this method.
   */
  async deleteMember(params: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    return this.repo.deleteMember(params);
  }

  /**
   * Updates a member's organization role and cascades effective team role changes.
   * Computes effective team role updates from the requested updates and current memberships.
   *
   * License checks must be performed by the caller (router) before invoking this method,
   * as they require request-scoped plan context.
   */
  async updateMemberRole(params: {
    organizationId: string;
    userId: string;
    role: OrganizationUserRole;
    teamRoleUpdates?: Array<{
      teamId: string;
      userId: string;
      role: string;
      customRoleId?: string;
    }>;
    currentMemberships: Array<{ teamId: string; role: TeamUserRole }>;
    organizationTeamIds: string[];
    currentUserId: string;
  }): Promise<void> {
    const {
      organizationId,
      userId,
      role,
      teamRoleUpdates,
      currentMemberships,
      organizationTeamIds,
      currentUserId,
    } = params;

    const organizationTeamIdSet = new Set(organizationTeamIds);

    const requestedTeamRoleUpdates = (teamRoleUpdates ?? []).reduce<
      Array<{ teamId: string; role: TeamRoleValue; customRoleId?: string }>
    >((acc, update) => {
      if (update.userId !== userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Team role update user must match target member",
        });
      }
      if (!organizationTeamIdSet.has(update.teamId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Team role update must belong to the organization",
        });
      }
      acc.push({
        teamId: update.teamId,
        role: update.role as TeamRoleValue,
        customRoleId: update.customRoleId,
      });
      return acc;
    }, []);

    const effectiveTeamRoleUpdates = computeEffectiveTeamRoleUpdates({
      requestedTeamRoleUpdates,
      currentMemberships,
      newOrganizationRole: role,
    });

    await this.repo.updateMemberRole({
      organizationId,
      userId,
      role,
      effectiveTeamRoleUpdates,
      currentUserId,
    });
  }

  /**
   * Updates a team member's role with admin guard enforced atomically in the repo.
   * License checks for EXTERNAL users must be performed by the caller (router).
   */
  async updateTeamMemberRole(params: {
    teamId: string;
    userId: string;
    role: string;
    customRoleId?: string;
    currentUserId: string;
  }): Promise<void> {
    const { teamId, userId, role, customRoleId, currentUserId } = params;

    if (isCustomRole(role)) {
      if (!customRoleId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "customRoleId is required when using a custom role",
        });
      }
      await this.repo.updateTeamMemberRole({
        teamId,
        userId,
        role: role as TeamUserRole,
        customRoleId,
        currentUserId,
      });
    } else {
      await this.repo.updateTeamMemberRole({
        teamId,
        userId,
        role: role as TeamUserRole,
        customRoleId: undefined,
        currentUserId,
      });
    }
  }

  /**
   * Returns paginated, enriched audit log entries for an organization.
   */
  async getAuditLogs(
    filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    return this.repo.getAuditLogs(filters);
  }

}
