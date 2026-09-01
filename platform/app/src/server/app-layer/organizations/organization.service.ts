import { generate } from "@langwatch/ksuid";
import type { AuthService as AuthCapability } from "@langwatch/auth-contract";
import type { AuthzBindingForSynthesis } from "@langwatch/authz-contract";
import {
  OrganizationService as OrganizationServiceContract,
  type AddOrganizationGroupBindingInput,
  type ClaimOrganizationBillingCustomerInput,
  type AddOrganizationTeamMemberInput,
  type ApplyOrganizationGroupEditsInput,
  type ChangeOrganizationGroupMemberInput,
  type CreateOrganizationGroupInput,
  type CreateOrganizationTeamInput,
  type CreateOrganizationTeamWithMembersInput,
  type DeleteOrganizationGroupInput,
  type GetOldestTeamInput,
  type GetOrganizationSettingsInput,
  type OrganizationSettings,
  type UpdateOrganizationSettingsInput,
  type UpdateOrganizationSettingsResult,
  type GetOrganizationGroupInput,
  type GetOrganizationTeamInput,
  type GetOrganizationTeamByIdInput,
  type GetOrganizationTeamBySlugForMemberInput,
  type GetOrganizationTeamWithMembersInput,
  type GetOrganizationBillingProfileInput,
  type GetOrganizationMembersInput,
  type ListMemberOrganizationGroupsInput,
  type ListOrganizationGroupsInput,
  type ListOrganizationTeamsInput,
  type ListOrganizationTeamsWithMembersInput,
  type ListOrganizationTeamAccessInput,
  type OrganizationGroup,
  type OrganizationGroupBinding,
  type OrganizationGroupDetails,
  type OrganizationGroupPage,
  type OrganizationGroupSummary,
  type OrganizationTeam,
  type OrganizationTeamAccess,
  type OrganizationTeamPage,
  type OrganizationTeamWithMembers,
  type EnsuredPersonalWorkspace,
  type FindPersonalWorkspaceInput,
  type PersonalFeatures,
  type PersonalWorkspace,
  type PersonalWorkspaceFeaturesInput,
  type PersonalWorkspaceInput,
  type RemoveOrganizationGroupBindingInput,
  type RemoveOrganizationTeamMemberInput,
  type RenameOrganizationGroupInput,
  type UpdateOrganizationTeamInput,
  type UpdateOrganizationTeamWithMembersInput,
} from "@langwatch/organization-contract";
import { TRPCError } from "@trpc/server";
import type { PrismaClient, User } from "~/generated/prisma/client";
import type { PromptService } from "@langwatch/prompt-contract";
import type { ShareService } from "@langwatch/share-contract";
import {
  type OrganizationIntent,
  type OrganizationUserRole,
  PricingModel,
  RoleBindingScopeType,
  type TeamUserRole,
} from "~/generated/prisma/client";
import type { LicenseEnforcementService } from "~/server/license-enforcement";
import type { MinimalUser } from "~/server/license-enforcement/license-enforcement.service";
import { getRoleChangeType } from "~/server/license-enforcement/member-classification";
import {
  assertNoPersonalTeamScope,
  findSharedTeamIds,
} from "~/server/role-bindings/personal-team-scope";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { TeamRoleValue } from "~/utils/memberRoleConstraints";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { slugify } from "~/utils/slugify";
import {
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
} from "@langwatch/enterprise-plan-gate";
import { isCustomRole } from "../../api/enterprise";
import { getApp } from "../app";
import type { PlanProviderUser } from "../subscription/plan-provider";
import { computeEffectiveTeamRoleUpdates } from "./compute-effective-team-role-updates";
import {
  CannotDisableSelfError,
  CannotRemoveSelfError,
  MemberNotFoundError,
  MemberSeatLimitReachedError,
} from "./errors";
import type {
  AuditLogFilters,
  CreateAndAssignResult,
  EnrichedAuditLog,
  FullyLoadedOrganization,
  MemberTeamBinding,
  OrganizationForBilling,
  OrganizationMemberSummary,
  OrganizationMemberWithUser,
  OrganizationProvisioningSummary,
  OrganizationRepository,
  OrganizationWithAdmins,
  OrganizationWithMembersAndTheirTeams,
  UpdateMemberRoleResult,
} from "./repositories/organization.repository";

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
type TeamMembershipLike = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  assignedRoleId: string | null;
  assignedRole?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export function enrichTeamWithRoleBindings<
  T extends {
    members: TeamMembershipLike[];
    id: string;
    projects: { id: string }[];
  },
>(
  team: T,
  userId: string,
  userRoleBindings: AuthzBindingForSynthesis[],
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
  const existingIndex = team.members.findIndex((m) => m.userId === userId);
  const newMembers =
    existingIndex >= 0
      ? team.members.map((m, i) => (i === existingIndex ? bindingMember : m))
      : [...team.members, bindingMember];
  return { ...team, members: newMembers };
}

/**
 * The raw client behind the repository, for orchestrations that compose
 * helpers operating on one (the personal-team guard, shared-team
 * enumeration, the license-enforcement repository). Absent only with the
 * null repository, where these operations are not meaningful.
 *
 * A standalone function, NOT a method on `OrganizationService`, for the same
 * reason as {@link enrichTeamWithRoleBindings}: the service instance is
 * wrapped with the `traced()` proxy, which turns every method call into an
 * async call returning a Promise, and a Promise standing in for a Prisma
 * client fails only later, deep inside whatever received it.
 */
function clientFromRepo(repo: OrganizationRepository): PrismaClient {
  const client = repo.getClient?.();
  if (!client) {
    throw new Error("This operation requires a Prisma-backed organization repository");
  }
  return client;
}

/**
 * The union of permissions granted by the custom roles behind these team
 * bindings, or undefined when none apply. Feeds seat classification, which
 * treats a member whose custom roles grant only view permissions as a Lite
 * Member.
 */
async function collectCustomRolePermissions({
  prisma,
  organizationId,
  currentTeamBindings,
}: {
  prisma: PrismaClient;
  organizationId: string;
  currentTeamBindings: Array<{ customRoleId: string | null }>;
}): Promise<string[] | undefined> {
  const customRoleIds = currentTeamBindings
    .map((binding) => binding.customRoleId)
    .filter((id): id is string => !!id);
  if (customRoleIds.length === 0) return undefined;
  const customRoles = await prisma.customRole.findMany({
    where: { id: { in: customRoleIds }, organizationId },
    select: { permissions: true },
  });
  const allPermissions: string[] = [];
  for (const customRole of customRoles) {
    // `permissions` is a Json column, so the row decides the shape, not the
    // type: read it defensively the way every other permission reader does.
    if (Array.isArray(customRole.permissions)) {
      allPermissions.push(
        ...customRole.permissions.filter(
          (permission): permission is string => typeof permission === "string",
        ),
      );
    }
  }
  return allPermissions.length > 0 ? allPermissions : undefined;
}

/**
 * The two plan gates on a member role change, in order: the seat
 * classification check (a Lite Member gaining non-view permissions re-checks
 * the full-member seats), then the Enterprise requirement on custom-role
 * assignments.
 */
async function assertPlanPermitsRoleChange({
  licenseEnforcement,
  organizationId,
  currentRole,
  userPermissions,
  role,
  teamRoleUpdates,
  planUser,
}: {
  licenseEnforcement: LicenseEnforcementService;
  organizationId: string;
  currentRole: OrganizationUserRole;
  userPermissions: string[] | undefined;
  role: OrganizationUserRole;
  teamRoleUpdates?: Array<{ role: string; customRoleId?: string }>;
  planUser?: PlanProviderUser;
}): Promise<void> {
  const changeType = getRoleChangeType(currentRole, userPermissions, role, undefined);

  const subscriptionLimits = await getApp().planProvider.getActivePlan({
    organizationId,
    user: planUser,
  });
  await licenseEnforcement.assertMemberTypeChangeAllowed({
    changeType,
    organizationId,
    limits: subscriptionLimits,
  });

  // Both forms of a custom-role assignment count: the `custom:{roleId}` role
  // string, and a builtin role string carrying a `customRoleId`, which the
  // cascade persists as a custom binding just the same.
  const hasCustomRoleAssignment = (teamRoleUpdates ?? []).some(
    (update) =>
      !!update.customRoleId ||
      (typeof update.role === "string" && isCustomRole(update.role)),
  );
  if (hasCustomRoleAssignment) {
    assertEnterprisePlanType({
      planType: subscriptionLimits.type,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
    });
  }
}

/**
 * Organization-level queries and mutations delegated from the tRPC router.
 * License checks remain in the router layer (they require request-scoped user context).
 */
export class OrganizationService extends OrganizationServiceContract {
  constructor(
    private readonly repo: OrganizationRepository,
    private readonly prompts: Pick<PromptService, "seedTagsForOrganization">,
    private readonly canonical?: OrganizationServiceContract,
    private readonly licenseEnforcement?: LicenseEnforcementService,
    private readonly shares?: ShareService,
    /**
     * Session revocation, resolved on each call rather than held.
     *
     * Auth is composed after Organization — Auth needs User, and User needs
     * Organization — so a value passed here would be the uninitialised half of
     * that cycle. A thunk is read when a member is actually disabled, by which
     * time the whole graph is built.
     */
    private readonly auth?: () => Pick<AuthCapability, "revokeAllBrowserSessions">,
  ) {
    super();
  }

  isMember(input: {
    organizationId: string;
    userId: string;
    includeDeactivated?: boolean;
  }): Promise<boolean> {
    return this.repo
      .findMembership({
        organizationId: input.organizationId,
        userId: input.userId,
      })
      .then(
        (membership) =>
          membership !== null &&
          (input.includeDeactivated === true || membership.disabledAt == null),
      );
  }

  getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]> {
    return this.getCanonicalService().getOrganizationMembers(input);
  }

  getOldestTeamId(input: GetOldestTeamInput): Promise<string> {
    return this.getCanonicalService().getOldestTeamId(input);
  }

  getTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.getCanonicalService().getTeam(input);
  }

  listTeams(input: ListOrganizationTeamsInput): Promise<OrganizationTeamPage> {
    return this.getCanonicalService().listTeams(input);
  }

  createTeam(input: CreateOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.getCanonicalService().createTeam(input);
  }

  updateTeam(input: UpdateOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.getCanonicalService().updateTeam(input);
  }

  archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.getCanonicalService().archiveTeam(input);
  }

  addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void> {
    return this.getCanonicalService().addTeamMember(input);
  }

  removeTeamMember(input: RemoveOrganizationTeamMemberInput): Promise<void> {
    return this.getCanonicalService().removeTeamMember(input);
  }

  getTeamById(input: GetOrganizationTeamByIdInput): Promise<OrganizationTeam> {
    return this.getCanonicalService().getTeamById(input);
  }

  getTeamBySlugForMember(
    input: GetOrganizationTeamBySlugForMemberInput,
  ): Promise<OrganizationTeam> {
    return this.getCanonicalService().getTeamBySlugForMember(input);
  }

  getTeamWithMembers(
    input: GetOrganizationTeamWithMembersInput,
  ): Promise<OrganizationTeamWithMembers> {
    return this.getCanonicalService().getTeamWithMembers(input);
  }

  listTeamsWithMembers(
    input: ListOrganizationTeamsWithMembersInput,
  ): Promise<OrganizationTeamWithMembers[]> {
    return this.getCanonicalService().listTeamsWithMembers(input);
  }

  createTeamWithMembers(
    input: CreateOrganizationTeamWithMembersInput,
  ): Promise<OrganizationTeam> {
    return this.getCanonicalService().createTeamWithMembers(input);
  }

  updateTeamWithMembers(input: UpdateOrganizationTeamWithMembersInput): Promise<void> {
    return this.getCanonicalService().updateTeamWithMembers(input);
  }

  listTeamAccess(
    input: ListOrganizationTeamAccessInput,
  ): Promise<OrganizationTeamAccess[]> {
    return this.getCanonicalService().listTeamAccess(input);
  }

  getGroup(input: GetOrganizationGroupInput): Promise<OrganizationGroupDetails> {
    return this.getCanonicalService().getGroup(input);
  }

  listGroups(input: ListOrganizationGroupsInput): Promise<OrganizationGroupPage> {
    return this.getCanonicalService().listGroups(input);
  }

  listGroupsForMember(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<OrganizationGroupSummary[]> {
    return this.getCanonicalService().listGroupsForMember(input);
  }

  createGroup(input: CreateOrganizationGroupInput): Promise<OrganizationGroup> {
    return this.getCanonicalService().createGroup(input);
  }

  renameGroup(input: RenameOrganizationGroupInput): Promise<OrganizationGroup> {
    return this.getCanonicalService().renameGroup(input);
  }

  deleteGroup(input: DeleteOrganizationGroupInput): Promise<void> {
    return this.getCanonicalService().deleteGroup(input);
  }

  addGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    return this.getCanonicalService().addGroupMember(input);
  }

  removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    return this.getCanonicalService().removeGroupMember(input);
  }

  listGroupBindings(
    input: GetOrganizationGroupInput,
  ): Promise<OrganizationGroupBinding[]> {
    return this.getCanonicalService().listGroupBindings(input);
  }

  addGroupBinding(
    input: AddOrganizationGroupBindingInput,
  ): Promise<OrganizationGroupBinding> {
    return this.getCanonicalService().addGroupBinding(input);
  }

  removeGroupBinding(input: RemoveOrganizationGroupBindingInput): Promise<void> {
    return this.getCanonicalService().removeGroupBinding(input);
  }

  applyGroupEdits(input: ApplyOrganizationGroupEditsInput): Promise<void> {
    return this.getCanonicalService().applyGroupEdits(input);
  }

  getBillingProfile(input: GetOrganizationBillingProfileInput) {
    return this.getCanonicalService().getBillingProfile(input);
  }

  claimBillingCustomerId(input: ClaimOrganizationBillingCustomerInput) {
    return this.getCanonicalService().claimBillingCustomerId(input);
  }

  ensurePersonalWorkspace(
    input: PersonalWorkspaceInput,
  ): Promise<EnsuredPersonalWorkspace> {
    return this.getCanonicalService().ensurePersonalWorkspace(input);
  }

  tryFindPersonalWorkspace(
    input: FindPersonalWorkspaceInput,
  ): Promise<PersonalWorkspace | null> {
    return this.getCanonicalService().tryFindPersonalWorkspace(input);
  }

  getPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    return this.getCanonicalService().getPersonalWorkspaceFeatures(input);
  }

  enableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    return this.getCanonicalService().enableAllPersonalWorkspaceFeatures(input);
  }

  disableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    return this.getCanonicalService().disableAllPersonalWorkspaceFeatures(input);
  }

  private getCanonicalService(): OrganizationServiceContract {
    if (!this.canonical) {
      throw new Error("Canonical OrganizationService is not configured");
    }
    return this.canonical;
  }

  private getLicenseEnforcementService(): LicenseEnforcementService {
    if (!this.licenseEnforcement) {
      throw new Error("LicenseEnforcementService is not configured");
    }
    return this.licenseEnforcement;
  }

  /**
   * Fails closed on purpose: a seat revoked without the session revoked leaves
   * the person working until their token happens to expire, so a process that
   * did not compose Auth must refuse the disable rather than half-perform it.
   */
  private getAuthService(): Pick<AuthCapability, "revokeAllBrowserSessions"> {
    const auth = this.auth?.();
    if (!auth) {
      throw new Error("Auth service is not configured");
    }
    return auth;
  }

  /**
   * The organization that owns one team, answered by the organization feature.
   *
   * Was a second copy of the same `Team.organizationId` read living on this
   * process's repository; the contract now declares it, so metering and the
   * personal-workspace doors ask one owner.
   */
  tryGetOrganizationIdByTeamId(input: { teamId: string }): Promise<string | null> {
    return this.getCanonicalService().tryGetOrganizationIdByTeamId(input);
  }

  async getUserOrgRole(params: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.repo.getUserOrgRole(params);
  }

  async getUserOrgRoleByTeamId(params: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.repo.getUserOrgRoleByTeamId(params);
  }

  async getProjectIds(organizationId: string): Promise<string[]> {
    return this.repo.getProjectIds(organizationId);
  }

  /**
   * The org's declared primary intent (ADR-038); null = intent unset
   * (legacy org). Consumed by the home resolver to pin the "/" landing.
   */
  async getPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null> {
    return this.repo.findPrimaryIntentById(organizationId);
  }

  async findWithAdmins(organizationId: string): Promise<OrganizationWithAdmins | null> {
    return this.repo.findWithAdmins(organizationId);
  }

  async updateSentPlanLimitAlert(organizationId: string, timestamp: Date): Promise<void> {
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
   * Creates an organization with a default team and assigns the given user as
   * admin.
   *
   * The repository writes the organization, the membership row and the first
   * team in one transaction. The founder's two ADMIN grants cannot join it —
   * they are ledger facts (ADR-092 delivery-plan PR 2) — so they follow it,
   * and a crash in between leaves an organization its founder has a seat in
   * and no grants on, which the next sign-in is what surfaces.
   */
  async createAndAssign(params: {
    userId: string;
    orgName?: string;
    phoneNumber?: string;
    signUpData?: Record<string, unknown>;
    primaryIntent?: OrganizationIntent | null;
    userDisplayName?: string | null;
  }): Promise<CreateAndAssignResult> {
    const orgName = params.orgName ?? params.userDisplayName ?? "My Organization";
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
      primaryIntent: params.primaryIntent,
      pricingModel: PricingModel.SEAT_EVENT,
    });

    await this.prompts.seedTagsForOrganization({
      organizationId: result.organization.id,
    });

    return result;
  }

  /**
   * Creates an organization with a default team and NO user attached: the
   * self-hosted instance provisioning path ({@link createAndAssign} requires a
   * member to assign, and this path runs before any user exists).
   *
   * An explicit slug is taken verbatim, so infrastructure-as-code can address
   * the organization by a natural key it chose; a missing slug is derived from
   * the name with an id suffix, exactly like sign-up. A taken slug raises
   * `organization_slug_taken` (409) from the repository.
   *
   * All of it or none of it: the repository commits the organization and its
   * team before the prompt tags are seeded, and until this method returns the
   * caller has no id to compensate with. A failure after that commit would
   * leave an organization with no bootstrap key, unreachable, holding a slug
   * that answers every retry with a 409 until somebody reaches the database
   * directly, so the seeding step undoes the commit before it rethrows.
   */
  async createForProvisioning(params: {
    name: string;
    slug?: string;
  }): Promise<CreateAndAssignResult> {
    const orgId = generate(KSUID_RESOURCES.ORGANIZATION).toString();
    const orgSlug =
      params.slug ??
      slugify(params.name, { lower: true, strict: true }) +
        "-" +
        orgId.substring(orgId.length - 6);

    const teamId = generate(KSUID_RESOURCES.TEAM).toString();
    const teamSlug =
      slugify(params.name, { lower: true, strict: true }) +
      "-" +
      teamId.substring(teamId.length - 6);

    const result = await this.repo.createForProvisioning({
      orgId,
      orgName: params.name,
      orgSlug,
      teamId,
      teamSlug,
      pricingModel: PricingModel.SEAT_EVENT,
    });

    try {
      await this.prompts.seedTagsForOrganization({
        organizationId: result.organization.id,
      });
    } catch (error) {
      // The caller has to see what actually went wrong, so a compensation
      // that fails too is reported rather than raised over the top of it.
      try {
        await this.repo.deleteProvisionedOrganization(result.organization.id);
      } catch (compensationError) {
        captureException(toError(compensationError));
      }
      throw error;
    }

    return result;
  }

  /** Every organization on the instance, for the instance-admin surface. */
  async listProvisioningSummaries(): Promise<OrganizationProvisioningSummary[]> {
    return this.repo.findAllProvisioningSummaries();
  }

  /**
   * Compensation for a provisioning run that created the organization but
   * could not finish: without its bootstrap key the organization is
   * unreachable, and its slug squats every retry as a 409. Removing what the
   * run created lets the caller simply retry. Provisioning is the only
   * caller; nothing else may delete an organization through this surface.
   */
  async deleteProvisionedOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<void> {
    await this.repo.deleteProvisionedOrganization(organizationId);
  }

  /** One organization's provisioning summary, or null when the id is unknown. */
  async getProvisioningSummary(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary | null> {
    return this.repo.findProvisioningSummaryById(organizationId);
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
   * The organization profile as the management surface reads it back:
   * everything a settings write accepts except the S3 secret (write-only) and
   * the SSO fields (staff-backoffice-only).
   *
   * The read, the field selection and the S3 credential decryption all belong
   * to the organization feature, so this process holds no second copy of what
   * "the settings" are. A missing organization arrives as the contract's
   * `OrganizationNotFoundError` rather than the bare `Error` this used to
   * raise, which is what lets a REST door answer a nameable refusal instead of
   * an unknown 500.
   */
  getSettings(input: GetOrganizationSettingsInput): Promise<OrganizationSettings> {
    return this.getCanonicalService().getSettings(input);
  }

  /**
   * Partial settings update. Only the fields present are written, unlike
   * {@link update}, whose full-form semantics clear absent S3 credentials.
   *
   * The write itself belongs to the organization feature — including the
   * before-and-after read that decides whether trace sharing was just switched
   * off. What stays here is the ADR-057 cascade that decision triggers: every
   * existing trace share link across the organization's projects is revoked,
   * not just new ones blocked, so re-enabling later never resurrects old
   * links. It stays because it crosses two features the organization does not
   * own (every project, and every share link on it).
   *
   * `traceShareRevocationRequired` is passed straight back out, so a caller
   * that repeats the pass itself (the REST handler composes
   * `revokeTraceSharesAfterOrganizationSettingsUpdate`) is idempotent rather
   * than a second, divergent source of truth.
   */
  async updateSettings(
    input: UpdateOrganizationSettingsInput,
  ): Promise<UpdateOrganizationSettingsResult> {
    const result = await this.getCanonicalService().updateSettings(input);

    if (result.traceShareRevocationRequired) {
      if (!this.shares) {
        throw new Error("Share service is required to disable trace sharing");
      }

      const shares = this.shares;
      const projectIds = await this.repo.getProjectIds(input.organizationId);
      // Settled, not `all`: the setting already reads "sharing off", so a
      // first rejection that skipped the remaining projects would leave live
      // share links behind an organization that says it has none. Every
      // project is attempted, and the caller is told which ones survived.
      const outcomes = await Promise.allSettled(
        projectIds.map((projectId) => shares.revokeAllTraceShares(projectId)),
      );
      const unrevoked = projectIds.filter(
        (_, index) => outcomes[index]?.status === "rejected",
      );
      if (unrevoked.length > 0) {
        throw new Error(
          `Trace sharing was disabled, but share links survive on ${unrevoked.length} project(s): ${unrevoked.join(", ")}`,
        );
      }
    }

    return result;
  }

  /**
   * Paginated membership list for the management surface. No caller
   * pre-check: authentication happens at the boundary through the
   * organization credential, not a session user.
   */
  async listMembers(params: {
    organizationId: string;
    includeDisabled?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<{ members: OrganizationMemberSummary[]; totalCount: number }> {
    return this.repo.findAllMembers({
      organizationId: params.organizationId,
      includeDisabled: params.includeDisabled ?? false,
      offset: params.offset ?? 0,
      limit: params.limit ?? 50,
    });
  }

  /**
   * One member with their role, disabled status and team bindings (personal
   * workspaces excluded). Throws {@link MemberNotFoundError} when the user is
   * not a member of this organization.
   */
  async getMember(params: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationMemberSummary & { teams: MemberTeamBinding[] }> {
    const membership = await this.repo.findMembership(params);
    if (!membership) {
      throw new MemberNotFoundError(params.userId);
    }
    const teams = await this.repo.findMemberTeamBindings(params);
    return { ...membership, teams };
  }

  /**
   * Removes a user from an organization and all its teams.
   *
   * Not one transaction, and deliberately ordered instead: the grants they
   * hold are revoked first and the membership row goes after, so a crash
   * leaves somebody holding a seat and no access rather than grants nobody
   * can reach.
   *
   * Refuses to remove the acting user's own membership so an organization
   * cannot lose its last acting administrator by accident; a credential that
   * acts as nobody (a service key) cannot trip the guard.
   */
  async deleteMember(params: {
    organizationId: string;
    userId: string;
    actingUserId?: string | null;
  }): Promise<void> {
    if (params.actingUserId != null && params.actingUserId === params.userId) {
      throw new CannotRemoveSelfError();
    }
    const membership = await this.repo.findMembership({
      organizationId: params.organizationId,
      userId: params.userId,
    });
    if (!membership) {
      throw new MemberNotFoundError(params.userId);
    }
    return this.repo.deleteMember({
      organizationId: params.organizationId,
      userId: params.userId,
      actingUserId: params.actingUserId ?? null,
    });
  }

  /**
   * Disables or re-enables a membership, which revokes or restores access to
   * this organization and returns or takes back a licensed seat. Role,
   * department and history are untouched, so this is reversible.
   *
   * Re-enabling consumes a seat, so it goes through the same check as
   * inviting someone. Disabling only ever frees one, and is what an
   * over-seats organization is being asked to do, so it is never blocked.
   * Disabling your own membership is refused for the same reason removing
   * it is: an organization must not lock itself out through its last acting
   * administrator.
   */
  async setMemberDisabled(params: {
    organizationId: string;
    userId: string;
    disabled: boolean;
    /** The user the credential acts as; null (a service key) skips the self-guard. */
    actingUser?: MinimalUser | null;
  }): Promise<void> {
    const { organizationId, userId, disabled, actingUser } = params;

    if (disabled && actingUser?.id != null && actingUser.id === userId) {
      throw new CannotDisableSelfError();
    }

    const membership = await this.repo.findMembership({
      organizationId,
      userId,
    });
    if (!membership) {
      throw new MemberNotFoundError(userId);
    }

    if (!disabled) {
      const enforcement = this.getLicenseEnforcementService();
      const result = await enforcement.checkLimit(
        organizationId,
        "members",
        actingUser ?? undefined,
      );
      if (!result.allowed) {
        throw new MemberSeatLimitReachedError({
          meta: {
            limitType: result.limitType,
            current: result.current,
            max: result.max,
          },
        });
      }
    }

    await this.repo.setMemberDisabled({ organizationId, userId, disabled });

    if (disabled) {
      // Revoking the seat has to revoke the live session too, or the person
      // keeps working until their token happens to expire. Through the
      // canonical Auth service: it clears the Better Auth session cache as
      // well as the rows, which is the half a plain delete misses.
      await this.getAuthService().revokeAllBrowserSessions({ userId });
    }

    // Disabling is a plain column write, not a grant write, so nothing else
    // retires the authorization snapshots cached for this organization. An
    // admin who has just revoked someone's access must not have to wait for a
    // cache to age out before it is true, and re-enabling must not leave the
    // person locked out for the same window.
    await getApp().authzGrants.invalidateOrganization({ organizationId });
  }

  /**
   * The full member-role-change orchestration: personal-workspace assertion,
   * shared-team scoping, seat classification (a Lite Member gaining non-view
   * permissions re-checks the full-member seats) and the Enterprise gate for
   * custom-role assignments, then the cascading role update itself.
   *
   * Seat overflow propagates as `LimitExceededError`
   * (`resource_limit_exceeded`), the same refusal every other member-limit
   * path raises, so the client's limit modal keeps opening off one shape.
   */
  async changeMemberRole(params: {
    organizationId: string;
    userId: string;
    role: OrganizationUserRole;
    teamRoleUpdates?: Array<{
      teamId: string;
      userId: string;
      role: string;
      customRoleId?: string;
    }>;
    /** Null when the actor is a service credential; self checks never match. */
    currentUserId: string | null;
    planUser?: PlanProviderUser;
  }): Promise<UpdateMemberRoleResult> {
    const { organizationId, userId, role, teamRoleUpdates, currentUserId } = params;
    const prisma = clientFromRepo(this.repo);

    const currentMember = await this.repo.findMembership({
      organizationId,
      userId,
    });
    if (!currentMember) {
      throw new MemberNotFoundError(userId);
    }

    // A caller who names a personal workspace outright is told so. Without
    // this the shared-teams-only set below would answer "that team is not in
    // the organization", which is both wrong and no help.
    await assertNoPersonalTeamScope({
      client: prisma,
      scopes: (teamRoleUpdates ?? []).map((update) => ({
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: update.teamId,
      })),
    });

    // Only the teams the organization shares. A seat decision is about the
    // person, so it applies to the teams they work in with other people and
    // leaves the workspace that is only theirs alone. Including it would ask
    // the organization to demote a team's last admin, which is refused, and
    // the whole role change would go down with the refusal.
    const organizationTeamIds = await findSharedTeamIds({
      client: prisma,
      organizationId,
    });

    const currentTeamBindings = await prisma.roleBinding.findMany({
      where: {
        organizationId,
        userId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: { in: organizationTeamIds },
      },
      select: { scopeId: true, role: true, customRoleId: true },
    });

    const currentMemberships = currentTeamBindings.map((binding) => ({
      teamId: binding.scopeId,
      role: binding.role,
    }));

    const userPermissions = await collectCustomRolePermissions({
      prisma,
      organizationId,
      currentTeamBindings,
    });

    await assertPlanPermitsRoleChange({
      licenseEnforcement: this.getLicenseEnforcementService(),
      organizationId,
      currentRole: currentMember.role,
      userPermissions,
      role,
      teamRoleUpdates,
      planUser: params.planUser,
    });

    return await this.updateMemberRole({
      organizationId,
      userId,
      role,
      teamRoleUpdates,
      currentMemberships,
      organizationTeamIds,
      currentUserId,
    });
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
    currentUserId: string | null;
  }): Promise<UpdateMemberRoleResult> {
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

    return await this.repo.updateMemberRole({
      organizationId,
      userId,
      role,
      effectiveTeamRoleUpdates,
      currentUserId,
    });
  }

  /**
   * Updates a team member's role. The repository decides the change under one
   * transaction — the last-admin guard included — and emits the grant it
   * resolves to once that has committed, since grants are ledger facts and
   * cannot ride a database transaction.
   *
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
