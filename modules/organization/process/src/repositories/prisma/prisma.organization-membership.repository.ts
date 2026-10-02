import type { LedgerActor } from "@langwatch/authorization";
import { ledgerActorFor } from "@langwatch/authorization";
import type {
  AuthzGrantCaller,
  AuthzGrantsService,
  AuthzLedgerBindingAttach,
} from "@langwatch/authz-contract";
import { newAuthzGrantId } from "@langwatch/authz-contract";
import { NotFoundError, ValidationError } from "@langwatch/handled-error";
import {
  CannotRemoveSelfAsLastAdminError,
  LiteMemberViewerOnlyError,
  TeamLastAdminRequiredError,
  TeamMembershipNotFoundError,
  TeamNotFoundError,
  CustomRoleNotAssignableError,
  CannotDemoteLastAdminError,
  CannotDisableLastAdminError,
  CannotRemoveLastAdminError,
  MemberNotFoundError,
  OrganizationNotFoundError,
  OrganizationSlugTakenError,
} from "@langwatch/organization-contract";
import type { OrganizationFounding, User } from "@langwatch/organization-contract";
import type {
  Organization,
  OrganizationIntent,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  OrganizationUserRole,
  Prisma,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

import { PrismaEffectiveTeamAdminsRepository } from "./prisma.effective-team-admins.repository.ts";
import {
  customRoleFromRecord,
  organizationFromRecord,
  organizationUserFromRecord,
  projectFromRecord,
  teamFromRecord,
  teamUserFromRecord,
  userFromRecord,
} from "./prisma.organization.mapper.ts";
import { PrismaPersonalTeamScopeRepository } from "./prisma.personal-team-scope.repository.ts";

/** The two shared read helpers this repository leans on. Stateless; the client rides each call. */
const personalTeamScope = PrismaPersonalTeamScopeRepository.create();
const effectiveTeamAdmins = PrismaEffectiveTeamAdminsRepository.create();
import { isCustomRole } from "../../rules/custom-role-naming.rules.ts";
import {
  isTeamRoleAllowedForOrganizationRole,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
  type TeamRoleValue,
} from "../../rules/member-role-constraints.rules.ts";
import type {
  AuditLogFilters,
  CreateAndAssignInput,
  CreateAndAssignResult,
  CreateForProvisioningInput,
  DeleteMemberInput,
  EnrichedAuditLog,
  FullyLoadedOrganization,
  MemberTeamBinding,
  OrganizationMemberSummary,
  OrganizationMemberWithUser,
  OrganizationProvisioningSummary,
  OrganizationMembershipRepository,
  OrganizationWithMembersAndTheirTeams,
  SetMemberDisabledInput,
  UpdateMemberRoleInput,
  UpdateMemberRoleResult,
  UpdateTeamMemberRoleInput,
} from "../organization-membership.repository.ts";

/**
 * The team's name for a refusal or a report, both of which are read by somebody
 * who knows the team by its name and not by its id, falling back to the id when the
 * row is gone.
 */
async function teamNameFor({
  tx,
  teamId,
}: {
  tx: Prisma.TransactionClient;
  teamId: string;
}): Promise<string> {
  const team = await tx.team.findUnique({
    where: { id: teamId },
    select: { name: true },
  });
  return team?.name ?? teamId;
}

/**
 * The organization's active administrators, locked for the rest of the
 * transaction.
 */
async function lockActiveAdmins({
  tx,
  organizationId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
}): Promise<{ userId: string }[]> {
  // `role::text` rather than a cast to the enum type: the type name would have
  // to be schema-qualified to be safe, and the comparison runs over one
  // organization's memberships either way. `ORDER BY` fixes the order rows are
  // locked in, so two callers racing over the same set queue behind each other
  // instead of deadlocking on a half-acquired one.
  return tx.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "OrganizationUser"
    WHERE "organizationId" = ${organizationId}
      AND "role"::text = ${OrganizationUserRole.ADMIN}
      AND "disabledAt" IS NULL
    ORDER BY "userId"
    FOR UPDATE
  `;
}

/**
 * The organization row of a provisioning run, with a slug race answered as
 * {@link OrganizationSlugTakenError}.
 */
async function createProvisionedOrganization(
  tx: Prisma.TransactionClient,
  input: CreateForProvisioningInput,
): Promise<Organization> {
  try {
    return await tx.organization.create({
      data: {
        id: input.orgId,
        name: input.orgName,
        slug: input.orgSlug,
        pricingModel: input.pricingModel,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      namesSlug(error.meta?.target)
    ) {
      throw new OrganizationSlugTakenError(input.orgSlug);
    }
    throw error;
  }
}

/**
 * True when a unique-constraint violation names the slug column. Prisma
 * reports the target as either the field list or the constraint name, so both
 * shapes are read.
 */
function namesSlug(target: unknown): boolean {
  if (Array.isArray(target)) {
    return target.some((field) => typeof field === "string" && field === "slug");
  }
  return typeof target === "string" && target.includes("slug");
}

/**
 * Points a member's binding on one scope at a role without replacing the row — an update, never
 * a delete-then-recreate, which would change its id mid-save while the member dialog stages
 * removals by id. Several rows on one scope still collapse to the one this sync sets.
 */
async function planUserScopeBinding({
  tx,
  organizationId,
  userId,
  scopeType,
  scopeId,
  role,
  customRoleId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  userId: string;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  role: TeamUserRole;
  customRoleId: string | null;
}): Promise<ScopeBindingPlan> {
  const rows = await tx.roleBinding.findMany({
    where: { organizationId, userId, scopeType, scopeId },
    // id breaks createdAt ties so the same row is kept on every execution
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const [keep, ...extras] = rows;
  const revokeIds = extras.map((row) => row.id);
  if (keep) {
    return {
      revokeIds,
      change: { bindingId: keep.id, role, customRoleId },
    };
  }
  return {
    revokeIds,
    attach: {
      bindingId: newAuthzGrantId(),
      principal: { userId },
      role,
      customRoleId,
      scopeType,
      scopeId,
    },
  };
}

/**
 * What a scope-binding correction resolves to once the transaction reads the rows: ids that
 * collapse away, and either a role change or a fresh attach. Emitted after commit, since
 * bindings are ledger facts and the ledger is their only writer (ADR-092 §13).
 */
type ScopeBindingPlan = {
  revokeIds: string[];
  change?: {
    bindingId: string;
    role: TeamUserRole;
    customRoleId: string | null;
  };
  attach?: AuthzLedgerBindingAttach;
};

/**
 * Emits a batch of plans, revocations first: a crash mid-batch leaves the member with less
 * access than asked for, never more, and the retry converges.
 */
async function emitScopeBindingPlans({
  writer,
  organizationId,
  plans,
  caller,
  actor,
}: {
  writer: AuthzGrantsService;
  organizationId: string;
  plans: ScopeBindingPlan[];
  caller: AuthzGrantCaller;
  actor: LedgerActor;
}): Promise<void> {
  const revokeIds = plans.flatMap((plan) => plan.revokeIds);
  if (revokeIds.length > 0) {
    await writer.revokeBindings({
      organizationId,
      bindingIds: revokeIds,
      actor,
    });
  }
  for (const plan of plans) {
    if (!plan.change) continue;
    await writer.changeBindingRole({
      organizationId,
      bindingId: plan.change.bindingId,
      role: plan.change.role,
      customRoleId: plan.change.customRoleId,
      caller,
      actor,
    });
  }
  const attaches = plans.flatMap((plan) => (plan.attach ? [plan.attach] : []));
  if (attaches.length > 0) {
    await writer.attachBindings({
      organizationId,
      bindings: attaches,
      caller,
      actor,
      onDuplicate: "skip",
    });
  }
}

/**
 * The KSUID resource a role binding is born under. Spelled as a literal, the way every
 * other feature package spells its own: the prefix is a PERSISTED format, and a second
 * description of it writes bindings the revocation queries never find.
 */
type TeamRoleUpdate = UpdateMemberRoleInput["effectiveTeamRoleUpdates"][number];

async function assertNotDemotingLastAdmin({
  tx,
  organizationId,
  role,
  currentRole,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  role: OrganizationUserRole;
  currentRole: OrganizationUserRole;
}): Promise<void> {
  if (role === OrganizationUserRole.ADMIN || currentRole !== OrganizationUserRole.ADMIN) return;
  const adminCount = await tx.organizationUser.count({
    where: { organizationId, role: OrganizationUserRole.ADMIN },
  });
  // Handled for the same reason as the disable guard: the tRPC boundary still maps the 400 to
  // BAD_REQUEST, and the REST surface answers the stable code instead of an unknown 500.
  if (adminCount <= 1) throw new CannotDemoteLastAdminError();
}

/** A team role update's own refusals: the Lite seat's cap, and a custom role that must exist. */
async function assertTeamRoleUpdateAllowed({
  tx,
  organizationId,
  role,
  teamId,
  teamRoleUpdate,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  role: OrganizationUserRole;
  teamId: string;
  teamRoleUpdate: TeamRoleUpdate;
}): Promise<void> {
  if (
    !isTeamRoleAllowedForOrganizationRole({
      organizationRole: role,
      teamRole: teamRoleUpdate.role as TeamRoleValue,
    })
  ) {
    throw new LiteMemberViewerOnlyError(await teamNameFor({ tx, teamId }));
  }

  const updateIsCustomRole = isCustomRole(teamRoleUpdate.role);
  if (updateIsCustomRole && !teamRoleUpdate.customRoleId) {
    throw new ValidationError("Custom role ID is required for custom role updates", {
      meta: {
        fieldErrors: {
          customRoleId: ["Pick which custom role to use."],
        },
        formErrors: ["Pick which custom role to use."],
      },
    });
  }

  if (updateIsCustomRole && teamRoleUpdate.customRoleId) {
    const customRole = await tx.customRole.findUnique({
      where: { id: teamRoleUpdate.customRoleId },
      select: { organizationId: true, kind: true },
    });
    if (customRole?.kind !== "custom" || customRole.organizationId !== organizationId) {
      throw new NotFoundError("custom_role_not_found", {
        resource: "CustomRole",
        id: teamRoleUpdate.customRoleId ?? "unknown",
      });
    }
  }
}

/** One team's role correction; none when the member already holds that role there. */
async function planTeamRoleUpdate({
  tx,
  organizationId,
  userId,
  role,
  teamId,
  teamRoleUpdate,
  currentMembership,
  teamsLeftWithoutAdmin,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  userId: string;
  role: OrganizationUserRole;
  teamId: string;
  teamRoleUpdate: TeamRoleUpdate;
  currentMembership: { role: string; customRoleId: string | null } | undefined;
  teamsLeftWithoutAdmin: { id: string; name: string }[];
}): Promise<ScopeBindingPlan[]> {
  if (!currentMembership) {
    throw new NotFoundError("team_membership_not_found", { resource: "TeamMember", id: userId });
  }
  await assertTeamRoleUpdateAllowed({ tx, organizationId, role, teamId, teamRoleUpdate });
  const updateIsCustomRole = isCustomRole(teamRoleUpdate.role);
  const nextRole = updateIsCustomRole ? TeamUserRole.CUSTOM : (teamRoleUpdate.role as TeamUserRole);
  const shouldClearCustomRole = !updateIsCustomRole;
  const wouldDemoteAdmin =
    currentMembership.role === TeamUserRole.ADMIN && nextRole !== TeamUserRole.ADMIN;

  if (wouldDemoteAdmin) {
    const adminsAfter = await effectiveTeamAdmins.projectAdminUserIdsWithoutDirectRole({
      tx,
      organizationId,
      teamId,
      userId,
    });
    if (adminsAfter.size === 0) {
      // A caller who named this team asked for a team-local change, and a team needs
      // an admin. A seat correction did not name it: the decision was about one
      // person's seat, and every shared team is still administered through any
      // ORGANIZATION-scoped ADMIN binding — so it goes through, and the team is
      // reported so the admin who did it is not left to discover this.
      if (teamRoleUpdate.origin === "requested") {
        throw new TeamLastAdminRequiredError(await teamNameFor({ tx, teamId }));
      }
      teamsLeftWithoutAdmin.push({
        id: teamId,
        name: await teamNameFor({ tx, teamId }),
      });
    }
  }

  const roleUnchanged =
    currentMembership.role === nextRole &&
    (shouldClearCustomRole
      ? currentMembership.customRoleId === null
      : currentMembership.customRoleId === teamRoleUpdate.customRoleId);
  if (roleUnchanged) return [];

  return [
    await planUserScopeBinding({
      tx,
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      role: nextRole,
      customRoleId: shouldClearCustomRole ? null : (teamRoleUpdate.customRoleId ?? null),
    }),
  ];
}

/** The ORGANIZATION-scoped grant kept in step with the seat; a Lite Member holds none. */
async function planOrganizationSeatBinding({
  tx,
  organizationId,
  userId,
  role,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  userId: string;
  role: OrganizationUserRole;
}): Promise<ScopeBindingPlan> {
  if (role !== OrganizationUserRole.EXTERNAL) {
    return planUserScopeBinding({
      tx,
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
      role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
      customRoleId: null,
    });
  }
  const orgRows = await tx.roleBinding.findMany({
    where: {
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    },
    select: { id: true },
  });
  return { revokeIds: orgRows.map((row) => row.id) };
}

/**
 * A Lite seat's correction of the shared PROJECT rows the team loop never sees (personal
 * workspaces are capped at resolution). Through planUserScopeBinding, so ids survive and a
 * pre-existing Viewer row can't collide on the partial unique index.
 */
async function planLiteProjectCorrections({
  tx,
  organizationId,
  userId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  userId: string;
}): Promise<ScopeBindingPlan[]> {
  const projectRows = await tx.roleBinding.findMany({
    where: {
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.PROJECT,
      OR: [{ role: { not: TeamUserRole.VIEWER } }, { customRoleId: { not: null } }],
    },
    select: { scopeId: true },
  });
  if (projectRows.length === 0) return [];
  const sharedProjects = await tx.project.findMany({
    where: {
      id: { in: projectRows.map((row) => row.scopeId) },
      isPersonal: false,
      team: { organizationId, isPersonal: false },
    },
    select: { id: true },
  });
  const plans: ScopeBindingPlan[] = [];
  for (const project of sharedProjects) {
    plans.push(
      await planUserScopeBinding({
        tx,
        organizationId,
        userId,
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: project.id,
        role: TeamUserRole.VIEWER,
        customRoleId: null,
      }),
    );
  }
  return plans;
}

type PlannedTeamRole = { organizationId: string; plan: ScopeBindingPlan };

async function getTeamForMemberChange({
  tx,
  teamId,
}: {
  tx: Prisma.TransactionClient;
  teamId: string;
}): Promise<{ organizationId: string; name: string }> {
  const team = await tx.team.findUnique({
    where: { id: teamId },
    select: { organizationId: true, name: true },
  });
  if (!team) throw new TeamNotFoundError(teamId);
  return team;
}

/** Whether the member holds a Lite Member seat in the organization. */
async function holdsLiteSeat({
  tx,
  organizationId,
  userId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  userId: string;
}): Promise<boolean> {
  const membership = await tx.organizationUser.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  return membership?.role === OrganizationUserRole.EXTERNAL;
}

async function getTeamBindingRole({
  tx,
  organizationId,
  teamId,
  userId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  teamId: string;
  userId: string;
}): Promise<string> {
  const binding = await tx.roleBinding.findFirst({
    where: { organizationId, scopeType: RoleBindingScopeType.TEAM, scopeId: teamId, userId },
    select: { role: true },
  });
  if (!binding) throw new TeamMembershipNotFoundError(userId);
  return binding.role;
}

/**
 * Only a save that demotes an admin can shrink the admin set, so the projection of its exact
 * post-state is the whole guard; a team already without an admin stays editable from here,
 * since this is one of the places somebody gets promoted back.
 */
async function assertTeamKeepsAnAdmin({
  tx,
  organizationId,
  team,
  userId,
  currentUserId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  team: { id: string; name: string };
  userId: string;
  currentUserId: string | null | undefined;
}): Promise<void> {
  const adminsAfter = await effectiveTeamAdmins.projectAdminUserIdsWithoutDirectRole({
    tx,
    organizationId,
    teamId: team.id,
    userId,
  });
  if (adminsAfter.size > 0) return;
  if (userId === currentUserId) throw new CannotRemoveSelfAsLastAdminError(team.name);
  throw new TeamLastAdminRequiredError(team.name);
}

async function planCustomTeamRole({
  tx,
  teamId,
  userId,
  currentUserId,
  customRoleId,
}: {
  tx: Prisma.TransactionClient;
  teamId: string;
  userId: string;
  currentUserId: string | null | undefined;
  customRoleId: string;
}): Promise<PlannedTeamRole> {
  const team = await getTeamForMemberChange({ tx, teamId });
  const { organizationId } = team;
  const customRole = await tx.customRole.findUnique({
    where: { id: customRoleId },
    select: { organizationId: true, permissions: true, kind: true },
  });
  if (customRole?.kind !== "custom" || customRole.organizationId !== organizationId) {
    throw new CustomRoleNotAssignableError(customRoleId);
  }
  if (await holdsLiteSeat({ tx, organizationId, userId })) {
    throw new LiteMemberViewerOnlyError(team.name);
  }
  const current = await getTeamBindingRole({ tx, organizationId, teamId, userId });
  if (current === TeamUserRole.ADMIN) {
    await assertTeamKeepsAnAdmin({
      tx,
      organizationId,
      team: { id: teamId, name: team.name },
      userId,
      currentUserId,
    });
  }
  return {
    organizationId,
    plan: await planUserScopeBinding({
      tx,
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      role: TeamUserRole.CUSTOM,
      customRoleId,
    }),
  };
}

async function planBuiltInTeamRole({
  tx,
  teamId,
  userId,
  currentUserId,
  role,
}: {
  tx: Prisma.TransactionClient;
  teamId: string;
  userId: string;
  currentUserId: string | null | undefined;
  role: UpdateTeamMemberRoleInput["role"];
}): Promise<PlannedTeamRole> {
  const team = await getTeamForMemberChange({ tx, teamId });
  const { organizationId } = team;
  if (
    (await holdsLiteSeat({ tx, organizationId, userId })) &&
    !isTeamRoleAllowedForOrganizationRole({
      organizationRole: OrganizationUserRole.EXTERNAL,
      teamRole: role as TeamRoleValue,
    })
  ) {
    throw new LiteMemberViewerOnlyError(team.name);
  }
  const current = await getTeamBindingRole({ tx, organizationId, teamId, userId });
  if (current === TeamUserRole.ADMIN && role !== TeamUserRole.ADMIN) {
    await assertTeamKeepsAnAdmin({
      tx,
      organizationId,
      team: { id: teamId, name: team.name },
      userId,
      currentUserId,
    });
  }
  return {
    organizationId,
    plan: await planUserScopeBinding({
      tx,
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
      role: role as TeamUserRole,
      customRoleId: null,
    }),
  };
}

function auditLogWhere({
  fence,
  filters,
}: {
  fence: Prisma.AuditLogWhereInput[];
  filters: AuditLogFilters;
}): Prisma.AuditLogWhereInput {
  const conditions: Prisma.AuditLogWhereInput[] = [
    { OR: fence },
    ...auditLogFilterConditions(filters),
  ];
  return conditions.length > 1 ? { AND: conditions } : { OR: fence };
}

/** The optional narrowing an audit-log read applies on top of the organization fence. */
function auditLogFilterConditions({
  userId,
  action,
  projectId,
  startDate,
  endDate,
  targetKind,
  targetId,
}: AuditLogFilters): Prisma.AuditLogWhereInput[] {
  const conditions: Prisma.AuditLogWhereInput[] = [];
  if (userId) {
    conditions.push({ userId });
  }

  if (action) {
    conditions.push({
      action: {
        contains: action,
        mode: "insensitive" as const,
      },
    });
  }

  if (projectId) {
    conditions.push({
      OR: [{ projectId }, { projectId: null }],
    });
  }

  if (startDate !== undefined || endDate !== undefined) {
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate !== undefined) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate !== undefined) {
      dateFilter.lte = new Date(endDate);
    }
    conditions.push({ createdAt: dateFilter });
  }

  // Gateway-resource deep-link filter (`/settings/audit-log?targetKind=…
  // &targetId=…`). Both columns live on `AuditLog` post-consolidation —
  // see migration 20260425000000_consolidate_gateway_audit_into_audit_log.
  // targetId is only honored when paired with targetKind so a stray
  // `?targetId=` from a typo'd URL cannot match across kinds.
  if (targetKind) {
    conditions.push({ targetKind: targetKind });
    if (targetId) {
      conditions.push({ targetId: targetId });
    }
  }
  return conditions;
}

export class PrismaOrganizationMembershipRepository implements OrganizationMembershipRepository {
  static create(options: {
    database: PrismaClient;
    /**
     * The grant ledger every membership write states its access on.
     */
    grants: AuthzGrantsService;
  }): PrismaOrganizationMembershipRepository {
    return new PrismaOrganizationMembershipRepository(options.database, options.grants);
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly writer: AuthzGrantsService,
  ) {}

  findPersonalTeamsInScopes(params: {
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[];
  }): Promise<{ name: string }[]> {
    return personalTeamScope.findPersonalTeamsInScopes({
      client: this.prisma,
      scopes: params.scopes,
    });
  }

  findSharedTeamIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    return personalTeamScope.findSharedTeamIds({ client: this.prisma, organizationId });
  }

  async findTeamGrants({
    organizationId,
    userId,
    teamIds,
  }: {
    organizationId: string;
    userId: string;
    teamIds: string[];
  }): Promise<{ scopeId: string; role: TeamUserRole; customRoleId: string | null }[]> {
    return this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        userId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: { in: teamIds },
      },
      select: { scopeId: true, role: true, customRoleId: true },
    });
  }

  async findCustomRolePermissions({
    organizationId,
    customRoleIds,
  }: {
    organizationId: string;
    customRoleIds: string[];
  }): Promise<unknown[]> {
    const roles = await this.prisma.customRole.findMany({
      where: { id: { in: customRoleIds }, organizationId },
      select: { permissions: true },
    });

    return roles.map((role) => role.permissions);
  }

  async findUserOrgRoleByTeamId({
    userId,
    teamId,
  }: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    // The Prisma multitenancy middleware rejects `OrganizationUser`
    // queries that don't pin an `organizationId` in the where clause.
    // Resolve teamId -> organizationId first, then look up the
    // membership directly — keeps the middleware happy without
    // exempting the model.
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    if (!team) return null;
    const orgUser = await this.prisma.organizationUser.findFirst({
      where: {
        userId,
        organizationId: team.organizationId,
        disabledAt: null,
      },
      select: { role: true },
    });
    return orgUser?.role ?? null;
  }

  async getOrganizationIntent(
    organizationId: string,
  ): Promise<{ primaryIntent: OrganizationIntent | null }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { primaryIntent: true },
    });
    if (organization === null) throw new OrganizationNotFoundError(organizationId);
    return organization;
  }

  async createAndAssign(input: CreateAndAssignInput): Promise<CreateAndAssignResult> {
    const created = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          id: input.orgId,
          name: input.orgName,
          slug: input.orgSlug,
          phoneNumber: input.phoneNumber,
          signupData: input.signUpData as Prisma.InputJsonValue | undefined,
          primaryIntent: input.primaryIntent ?? null,
          pricingModel: input.pricingModel,
        },
      });

      await tx.organizationUser.create({
        data: {
          userId: input.userId,
          organizationId: organization.id,
          role: "ADMIN",
        },
      });

      const team = await tx.team.create({
        data: {
          id: input.teamId,
          name: input.orgName,
          slug: input.teamSlug,
          organizationId: organization.id,
        },
      });

      return {
        organization: { id: organization.id, name: organization.name },
        team: { id: team.id, slug: team.slug, name: team.name },
      };
    });

    // The organization, its membership row and its first team are not grant
    // facts; the founder's two ADMIN grants are, so they are emitted once the
    // scopes they point at exist.
    await this.writer.attachBindings({
      organizationId: created.organization.id,
      bindings: [
        {
          bindingId: newAuthzGrantId(),
          principal: { userId: input.userId },
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: created.organization.id,
        },
        {
          bindingId: newAuthzGrantId(),
          principal: { userId: input.userId },
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: created.team.id,
        },
      ],
      caller: { type: "system" },
      actor: ledgerActorFor({
        userId: input.userId,
        fallback: "organizationService",
      }),
      onDuplicate: "skip",
    });

    return created;
  }

  async createForProvisioning(input: CreateForProvisioningInput): Promise<CreateAndAssignResult> {
    return this.prisma.$transaction(async (tx) => {
      // Deterministic answer for the common case; the catch inside
      // `createProvisionedOrganization` still covers the race where two
      // provisioning runs claim one slug.
      const taken = await tx.organization.findUnique({
        where: { slug: input.orgSlug },
        select: { id: true },
      });
      if (taken) {
        throw new OrganizationSlugTakenError(input.orgSlug);
      }

      const organization = await createProvisionedOrganization(tx, input);

      const team = await tx.team.create({
        data: {
          id: input.teamId,
          name: input.orgName,
          slug: input.teamSlug,
          organizationId: organization.id,
        },
      });

      return {
        organization: { id: organization.id, name: organization.name },
        team: { id: team.id, slug: team.slug, name: team.name },
      };
    });
  }

  async findAllProvisioningSummaries(): Promise<OrganizationProvisioningSummary[]> {
    const organizations = await this.prisma.organization.findMany({
      select: { id: true, name: true, slug: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return organizations.map((organization) => ({
      ...organization,
      createdAt: fromDate(organization.createdAt),
    }));
  }

  async markSelfHostedCustomer(organizationId: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { selfHostedCustomer: true },
    });
  }

  async findSelfHostedCustomers(): Promise<{ organizationId: string; organizationName: string }[]> {
    const rows = await this.prisma.organization.findMany({
      where: { selfHostedCustomer: true },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ organizationId: row.id, organizationName: row.name }));
  }

  /**
   * The founder is the earliest membership. Founders' later memberships are asked of
   * Organization, since a membership read bounded only by user spans every tenant.
   */
  async findFoundedBetween({
    fromMs,
    toMs,
    followUntilMs,
  }: {
    fromMs: number;
    toMs: number;
    followUntilMs: number;
  }): Promise<OrganizationFounding[]> {
    const organizations = await this.prisma.organization.findMany({
      where: { createdAt: { gte: new Date(fromMs), lte: new Date(toMs) } },
      select: { id: true, createdAt: true },
    });
    if (organizations.length === 0) return [];

    const memberships = await this.prisma.organizationUser.findMany({
      where: { organizationId: { in: organizations.map((row) => row.id) } },
      select: { organizationId: true, userId: true },
      orderBy: { createdAt: "asc" },
    });
    const founderOf = new Map<string, string>();
    for (const membership of memberships) {
      if (!founderOf.has(membership.organizationId)) {
        founderOf.set(membership.organizationId, membership.userId);
      }
    }
    if (founderOf.size === 0) return [];

    const followed = {
      userId: { in: [...new Set(founderOf.values())] },
      createdAt: { gte: new Date(fromMs), lte: new Date(followUntilMs) },
    };
    const joined = await this.prisma.organization.findMany({
      where: { members: { some: followed } },
      select: { id: true, members: { where: followed, select: { userId: true, createdAt: true } } },
    });
    const membershipsOf = new Map<string, { organizationId: string; joinedAtMs: number }[]>();
    for (const organization of joined) {
      for (const member of organization.members) {
        const held = membershipsOf.get(member.userId) ?? [];
        held.push({ organizationId: organization.id, joinedAtMs: member.createdAt.getTime() });
        membershipsOf.set(member.userId, held);
      }
    }

    return organizations.flatMap((organization) => {
      const founderUserId = founderOf.get(organization.id);
      if (!founderUserId) return [];
      return [
        {
          organizationId: organization.id,
          founderUserId,
          foundedAtMs: organization.createdAt.getTime(),
          founderMemberships: membershipsOf.get(founderUserId) ?? [],
        },
      ];
    });
  }

  async findRepresentatives(
    organizationId: string,
  ): Promise<{ userId: string; organizationName: string }[]> {
    const [organization, membership] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      this.prisma.organizationUser.findFirst({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      }),
    ]);
    if (!organization || !membership) return [];
    return [{ userId: membership.userId, organizationName: organization.name }];
  }

  async deleteProvisionedOrganization(organizationId: string): Promise<void> {
    // Deliberately imperative, and it stays that way: this is a tenant purge, not a grant
    // write. The organization itself is going away, so there is no access left to describe and
    // no stream left to append to — emitting revocations for rows whose aggregate is being
    // deleted would only leave the ledger holding facts about a tenant that no longer exists.
    // Role bindings first: RoleBinding.apiKeyId restricts api-key deletion.
    await this.prisma.$transaction([
      this.prisma.roleBinding.deleteMany({ where: { organizationId } }),
      // The authorization read model. It carries organizationId as a plain column
      // and never a relation - facts derived from the log must not presume the row
      // they describe still exists - so nothing cascades them, and a purge that
      // skipped them would leave a deleted tenant's access rows behind as the only
      // surviving head. Usage before its Grant.
      this.prisma.grantUsage.deleteMany({ where: { organizationId } }),
      this.prisma.grant.deleteMany({ where: { organizationId } }),
      this.prisma.role.deleteMany({ where: { organizationId } }),
      // The migration machinery's own per-tenant rows follow the same rule:
      // plain organizationId columns, no relation, nothing cascades them. A
      // purge that left them behind would keep a deleted tenant enrolled and
      // its migration state answering the next pass.
      this.prisma.systemMigrationTenantState.deleteMany({
        where: { tenantId: organizationId },
      }),
      this.prisma.systemMigrationEnrollment.deleteMany({
        where: { organizationId },
      }),
      this.prisma.apiKey.deleteMany({ where: { organizationId } }),
      this.prisma.promptTag.deleteMany({ where: { organizationId } }),
      this.prisma.teamUser.deleteMany({
        where: { team: { organizationId } },
      }),
      this.prisma.organizationUser.deleteMany({ where: { organizationId } }),
      this.prisma.team.deleteMany({ where: { organizationId } }),
      this.prisma.organization.deleteMany({ where: { id: organizationId } }),
    ]);
  }

  async getProvisioningSummaryById(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true, createdAt: true },
    });
    if (organization === null) throw new OrganizationNotFoundError(organizationId);
    return { ...organization, createdAt: fromDate(organization.createdAt) };
  }

  async findAllForUser(params: {
    userId: string;
    isDemo: boolean;
    demoProjectUserId: string;
    demoProjectId: string;
  }): Promise<FullyLoadedOrganization[]> {
    const { userId, isDemo, demoProjectId } = params;

    const organizations = await this.prisma.organization.findMany({
      where: {
        OR: [
          ...(isDemo
            ? [
                {
                  teams: {
                    some: {
                      archivedAt: null,
                      projects: {
                        some: { id: demoProjectId },
                      },
                    },
                  },
                },
              ]
            : []),
          {
            // A disabled membership must not put the organization back in the
            // user's switcher, or they would see a workspace they cannot act
            // in.
            members: {
              some: {
                userId,
                disabledAt: null,
              },
            },
          },
        ],
      },
      include: {
        members: {
          where: {
            userId,
          },
        },
        teams: {
          where: {
            archivedAt: null,
          },
          include: {
            members: {
              include: {
                assignedRole: true,
              },
            },
            projects: {
              where: {
                archivedAt: null,
                // Hide the internal-governance Project from every UI consumer.
                // It exists only as a routing/tenancy artifact for IngestionSource
                // data; never user-visible. See specs/ai-gateway/governance/
                // architecture-invariants.feature + ui-contract.feature.
                kind: { not: "internal_governance" },
              },
            },
          },
        },
      },
    });
    return organizations.map(fullyLoadedOrganizationFromRecord);
  }

  async findOrganizationWithMembers(params: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null> {
    const { organizationId, userId, includeDeactivated } = params;

    const organization = await this.prisma.organization.findFirst({
      where: {
        id: organizationId,
        // The caller must hold an active membership to see the organization.
        // The `members` list below is deliberately NOT filtered the same way:
        // an admin has to see who is disabled in order to re-enable them.
        members: {
          some: {
            userId,
            disabledAt: null,
          },
        },
      },
      include: {
        members: {
          ...(!includeDeactivated ? { where: { user: { deactivatedAt: null } } } : {}),
          orderBy: [{ user: { name: "asc" } }, { user: { email: "asc" } }, { userId: "asc" }],
          include: {
            user: {
              include: {
                teamMemberships: {
                  where: { team: { archivedAt: null } },
                  include: {
                    team: true,
                    assignedRole: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (organization === null) return null;
    const { members, ...record } = organization;
    return {
      ...organizationFromRecord(record),
      members: members.map(memberWithUserFromRecord),
    };
  }

  async findMemberById(params: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null> {
    const { organizationId, userId, currentUserId } = params;

    const currentUserMembership = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId: currentUserId,
        disabledAt: null,
      },
    });

    if (!currentUserMembership) {
      return null;
    }

    const member = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId,
      },
      include: {
        user: {
          include: {
            teamMemberships: {
              where: { team: { archivedAt: null } },
              include: {
                team: true,
                assignedRole: true,
              },
            },
          },
        },
      },
    });
    return member === null ? null : memberWithUserFromRecord(member);
  }

  async findMemberUserIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    const rows = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /** Matched on who accepted, not the address: an address can change afterwards. */
  async findInvitedMemberIds({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.organizationInvite.findMany({
      where: { organizationId, acceptedByUserId: { in: [...userIds] } },
      select: { acceptedByUserId: true },
    });
    return rows.flatMap((row) => (row.acceptedByUserId === null ? [] : [row.acceptedByUserId]));
  }

  async findActiveMemberUsers(organizationId: string): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      where: {
        deactivatedAt: null,
        orgMemberships: {
          some: {
            organizationId,
            disabledAt: null,
          },
        },
      },
    });
    return users.map(userFromRecord);
  }

  async findMemberUsersIncludingDeactivated({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      where: { orgMemberships: { some: { organizationId } } },
    });
    return users.map(userFromRecord);
  }

  async findMembersWithDepartments({ organizationId }: { organizationId: string }): Promise<
    {
      userId: string;
      departmentId: string | null;
      user: { name: string | null; email: string | null };
    }[]
  > {
    return this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true, departmentId: true, user: { select: { name: true, email: true } } },
    });
  }

  async assignMemberDepartment(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    const { organizationId, userId, departmentId } = input;
    const result = await this.prisma.organizationUser.updateMany({
      where: { userId, organizationId },
      data: { departmentId },
    });
    return result.count > 0;
  }

  async findTeamsWithDepartments({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; name: string; departmentId: string | null }[]> {
    return this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true, name: true, departmentId: true },
      orderBy: { name: "asc" },
    });
  }

  async assignTeamDepartment(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    const result = await this.prisma.team.updateMany({
      where: { id: input.teamId, organizationId: input.organizationId },
      data: { departmentId: input.departmentId },
    });
    return result.count > 0;
  }

  async findMemberDepartments({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string | null }[]> {
    return this.prisma.organizationUser.findMany({
      where: { organizationId, userId: { in: [...userIds] } },
      select: { userId: true, departmentId: true },
    });
  }

  async findMemberTeamIds(input: { organizationId: string; userId: string }): Promise<string[]> {
    const memberships = await this.prisma.teamUser.findMany({
      where: { userId: input.userId, team: { organizationId: input.organizationId } },
      select: { teamId: true },
    });
    return memberships.map(({ teamId }) => teamId);
  }

  async getMembership(params: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationMemberSummary> {
    const { organizationId, userId } = params;
    const membership = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: {
        userId: true,
        organizationId: true,
        role: true,
        disabledAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!membership) throw new MemberNotFoundError(userId);
    return memberSummaryFromRecord(membership);
  }

  async findActiveAdministratorIds(params: { organizationId: string }): Promise<string[]> {
    const rows = await this.prisma.organizationUser.findMany({
      where: {
        organizationId: params.organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      },
      select: { userId: true },
    });

    return rows.map((row) => row.userId);
  }

  async listAllMembers(params: {
    organizationId: string;
    includeDisabled: boolean;
    offset: number;
    limit: number;
  }): Promise<{ members: OrganizationMemberSummary[]; totalCount: number }> {
    const { organizationId, includeDisabled, offset, limit } = params;
    const where = {
      organizationId,
      ...(includeDisabled ? {} : { disabledAt: null }),
    };

    const [members, totalCount] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where,
        select: {
          userId: true,
          organizationId: true,
          role: true,
          disabledAt: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ user: { name: "asc" } }, { user: { email: "asc" } }, { userId: "asc" }],
        skip: offset,
        take: limit,
      }),
      this.prisma.organizationUser.count({ where }),
    ]);

    return { members: members.map(memberSummaryFromRecord), totalCount };
  }

  async findMemberTeamBindings(params: {
    organizationId: string;
    userId: string;
  }): Promise<MemberTeamBinding[]> {
    const { organizationId, userId } = params;
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        userId,
        scopeType: RoleBindingScopeType.TEAM,
      },
      select: {
        scopeId: true,
        role: true,
        customRoleId: true,
        customRole: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (bindings.length === 0) return [];

    const teams = await this.prisma.team.findMany({
      where: {
        id: { in: bindings.map((b) => b.scopeId) },
        organizationId,
      },
      select: { id: true, name: true, isPersonal: true },
    });
    const teamsById = new Map(teams.map((team) => [team.id, team]));

    // A binding whose team is missing from the lookup points outside the
    // organization (or at a deleted team) and carries no manageable access;
    // personal workspaces are not managed from these surfaces at all.
    return bindings.flatMap((binding) => {
      const team = teamsById.get(binding.scopeId);
      if (!team || team.isPersonal) return [];
      return [
        {
          teamId: team.id,
          teamName: team.name,
          role: binding.role,
          customRoleId: binding.customRoleId,
          customRoleName: binding.customRole?.name ?? null,
        },
      ];
    });
  }

  /**
   * One insert carrying its admission intent, so a process that stops before
   * the grant lands still leaves the marker. P2002 HERE is a concurrent
   * callback or a retry; any other constraint is a real failure.
   */
  async createMembership(input: {
    organizationId: string;
    userId: string;
    pendingAdmissionId: string;
  }): Promise<"created" | "already-present"> {
    try {
      await this.prisma.organizationUser.create({
        data: {
          userId: input.userId,
          organizationId: input.organizationId,
          role: OrganizationUserRole.MEMBER,
          pendingSsoGrantId: input.pendingAdmissionId,
        },
      });
      return "created";
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return "already-present";
      }
      throw error;
    }
  }

  /**
   * Removes a membership, and the personal workspace that came with it.
   */
  async deleteMember(input: DeleteMemberInput): Promise<void> {
    const { organizationId, userId, actingUserId } = input;
    const actor = ledgerActorFor({
      userId: actingUserId,
      fallback: "organizationService",
    });
    const revokeTheirGrants = () =>
      this.writer.revokeBindingsWhere({
        organizationId,
        where: { userId },
        actor,
        reason: "organization membership removed",
      });

    const member = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true, disabledAt: true },
    });

    if (!member) {
      // The membership is already gone, which is also what a retry of a removal that
      // died between the two writes below sees. Revoking again is a no-op when the
      // first attempt finished and the repair when it did not, so the retry can
      // still reach grants the seat no longer names — refusing outright left them
      // orphaned, and a re-invite reactivated them.
      await revokeTheirGrants();
      throw new MemberNotFoundError(userId);
    }

    await this.assertRemovalKeepsAnActiveAdmin({ organizationId, member });

    // The seat goes before the grants, so the revocation's epoch bump is the last
    // write and no check can cache access the removal is about to take away. A
    // crash between the two leaves orphaned grants, which the no-member branch
    // above revokes on retry; a refusal inside the transaction revokes nothing.
    await this.prisma.$transaction(async (tx) => {
      await this.deleteMembershipRow({ tx, organizationId, userId });
      await this.archivePersonalWorkspaces({ tx, organizationId, userId });
    });
    await revokeTheirGrants();
  }

  /**
   * Same guard as disabling or demoting the last admin, and the only irreversible one of the
   * three: an organization with no admin who can sign in can't be recovered from inside the
   * product. Read ahead of the revocation as well as inside the removal transaction.
   */
  private async assertRemovalKeepsAnActiveAdmin({
    organizationId,
    member,
  }: {
    organizationId: string;
    member: { role: OrganizationUserRole; disabledAt: Date | null };
  }): Promise<void> {
    if (member.role !== OrganizationUserRole.ADMIN || member.disabledAt !== null) {
      return;
    }
    const activeAdmins = await this.prisma.organizationUser.count({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      },
    });
    if (activeAdmins <= 1) {
      throw new CannotRemoveLastAdminError();
    }
  }

  /**
   * The membership delete itself, re-guarded under the transaction: the
   * pre-transaction reads are advisory, this locked read is the authority.
   */
  private async deleteMembershipRow({
    tx,
    organizationId,
    userId,
  }: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const stillAMember = await tx.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true, disabledAt: true },
    });

    if (!stillAMember) {
      throw new MemberNotFoundError(userId);
    }

    if (stillAMember.role === OrganizationUserRole.ADMIN && stillAMember.disabledAt === null) {
      const activeAdmins = await lockActiveAdmins({ tx, organizationId });

      if (activeAdmins.length <= 1) {
        throw new CannotRemoveLastAdminError();
      }
    }

    await tx.organizationUser.delete({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });
  }

  /**
   * Archives the removed member's personal team and project, on the same
   * terms `PersonalWorkspaceService.ensure()` reactivates them.
   */
  private async archivePersonalWorkspaces({
    tx,
    organizationId,
    userId,
  }: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const archivedAt = new Date();
    const personalTeams = await tx.team.findMany({
      where: {
        organizationId,
        ownerUserId: userId,
        isPersonal: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (personalTeams.length === 0) return;

    const personalTeamIds = personalTeams.map((team) => team.id);
    // `isPersonal` on the same terms the reactivation reads it, so the two sides move the same
    // rows. A personal team holds nothing else today (creating a project in one, or moving one
    // into it, is refused), and the flag mirrors the team's, so this narrows nothing away; it
    // keeps the pair symmetric if that ever slips, since archiving what the revival would not
    // return is the failure with no way back.
    await tx.project.updateMany({
      where: {
        teamId: { in: personalTeamIds },
        isPersonal: true,
        archivedAt: null,
      },
      data: { archivedAt },
    });
    await tx.team.updateMany({
      where: { id: { in: personalTeamIds } },
      data: { archivedAt },
    });
  }

  async setMemberDisabled(input: SetMemberDisabledInput): Promise<void> {
    const { organizationId, userId, disabled } = input;

    await this.prisma.$transaction(async (tx) => {
      const member = await tx.organizationUser.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { role: true },
      });

      if (!member) {
        throw new MemberNotFoundError(userId);
      }

      // Same guard as demoting the last admin: an organization with no admin
      // who can sign in cannot be recovered from inside the product. Locked
      // for the same reason the removal guard locks: a disable and a removal
      // aimed at the two remaining admins would otherwise both pass.
      if (disabled && member.role === OrganizationUserRole.ADMIN) {
        const activeAdmins = await lockActiveAdmins({ tx, organizationId });

        if (activeAdmins.length <= 1) {
          // Handled rather than a TRPCError: the tRPC boundary maps a 400
          // HandledError to BAD_REQUEST anyway, and the REST surface answers
          // the stable code instead of flattening this refusal to an unknown
          // 500.
          throw new CannotDisableLastAdminError();
        }
      }

      await tx.organizationUser.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { disabledAt: disabled ? new Date() : null },
      });
    });
  }

  async updateMemberRole(input: UpdateMemberRoleInput): Promise<UpdateMemberRoleResult> {
    const { organizationId, userId, role, effectiveTeamRoleUpdates } = input;

    // Teams whose only team-scoped admin this seat change corrected away. Not a
    // failure, and not silent either: the caller reports them to whoever made
    // the decision.
    const teamsLeftWithoutAdmin: { id: string; name: string }[] = [];
    // The seat change reads and corrects every scope the seat caps; the
    // corrections are collected here and emitted as commands once the
    // membership transaction has committed.
    const plans: ScopeBindingPlan[] = [];

    // The transaction answers the seat the member held before it, kept so a
    // failed correction can put it back (see the compensation below).
    const previousRole = await this.prisma.$transaction(async (tx) => {
      const currentMember = await tx.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
      });

      if (!currentMember) {
        throw new MemberNotFoundError(userId);
      }

      await assertNotDemotingLastAdmin({
        tx,
        organizationId,
        role,
        currentRole: currentMember.role,
      });

      await tx.organizationUser.update({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
        data: { role },
      });

      plans.push(await planOrganizationSeatBinding({ tx, organizationId, userId, role }));

      // Shared teams only, matching what the router resolved before it computed
      // the effective updates. The personal workspace each member gets to
      // themselves has one admin, its owner, so a downgrade that reached it
      // would trip the last-admin guard below and roll this transaction back,
      // taking the organization role change with it.
      const organizationTeamIds = await personalTeamScope.findSharedTeamIds({
        client: tx,
        organizationId,
      });

      const currentMemberships = await tx.roleBinding.findMany({
        where: {
          organizationId,
          userId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: { in: organizationTeamIds },
        },
        select: {
          scopeId: true,
          role: true,
          customRoleId: true,
        },
      });
      const currentMembershipByTeamId = new Map(currentMemberships.map((m) => [m.scopeId, m]));

      const dedupedTeamRoleUpdates = new Map(effectiveTeamRoleUpdates.map((u) => [u.teamId, u]));

      for (const [teamId, teamRoleUpdate] of dedupedTeamRoleUpdates.entries()) {
        plans.push(
          ...(await planTeamRoleUpdate({
            tx,
            organizationId,
            userId,
            role,
            teamId,
            teamRoleUpdate,
            currentMembership: currentMembershipByTeamId.get(teamId),
            teamsLeftWithoutAdmin,
          })),
        );
      }

      if (role === OrganizationUserRole.EXTERNAL) {
        plans.push(...(await planLiteProjectCorrections({ tx, organizationId, userId })));
      }

      const finalAdminCount = await tx.organizationUser.count({
        where: {
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });

      if (finalAdminCount === 0) {
        throw new CannotDemoteLastAdminError();
      }

      return currentMember.role;
    });

    // The seat has committed and the grants it caps have not. A ledger append
    // cannot join the transaction above, so the correction is compensated
    // instead of shared with it: if it fails the seat goes back to the role it
    // held, and the caller sees the whole change refused with the member's old
    // access standing rather than an ADMIN binding under a MEMBER seat.
    try {
      await emitScopeBindingPlans({
        writer: this.writer,
        organizationId,
        plans,
        caller: input.caller,
        actor: ledgerActorFor({
          userId: input.currentUserId,
          fallback: "organizationService",
        }),
      });
    } catch (error) {
      if (previousRole !== role) {
        await this.prisma.organizationUser.updateMany({
          where: { organizationId, userId, role },
          data: { role: previousRole },
        });
      }
      throw error;
    }

    return { teamsLeftWithoutAdmin };
  }

  async updateTeamMemberRole(input: UpdateTeamMemberRoleInput): Promise<void> {
    const { teamId, userId, role, customRoleId, currentUserId, caller } = input;
    const planned = await this.prisma.$transaction((tx) =>
      customRoleId
        ? planCustomTeamRole({ tx, teamId, userId, currentUserId, customRoleId })
        : planBuiltInTeamRole({ tx, teamId, userId, currentUserId, role }),
    );

    await emitScopeBindingPlans({
      writer: this.writer,
      organizationId: planned.organizationId,
      plans: [planned.plan],
      caller,
      actor: ledgerActorFor({
        userId: currentUserId,
        fallback: "organizationService",
      }),
    });
  }

  async getAuditLogs(
    filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    const { organizationId, projectId, pageOffset, pageSize } = filters;

    const orgUserIds = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const orgUserIdsList = orgUserIds.map((ou) => ou.userId);

    // Project-level rows are written with `organizationId = NULL`, so they can
    // only be re-anchored through their project. Matching `projectId: { not:
    // null }` anchored them to nothing and returned every organization a member
    // also belongs to — payloads included. The organization's own projects are
    // the fence.
    const orgProjects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    const orgProjectIds = orgProjects.map((row) => row.id);

    if (projectId && !orgProjectIds.includes(projectId)) {
      return { auditLogs: [], totalCount: 0 };
    }

    const orgIdConditions: Prisma.AuditLogWhereInput[] = [{ organizationId }];

    if (orgUserIdsList.length > 0 && orgProjectIds.length > 0) {
      orgIdConditions.push({
        organizationId: null,
        userId: { in: orgUserIdsList },
        projectId: { in: orgProjectIds },
      });
    }

    const where = auditLogWhere({ fence: orgIdConditions, filters });

    const [totalCount, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip: pageOffset,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // userId is nullable post-consolidation (system-actor writes) — filter
    // null out before passing to the Prisma `IN` predicate, which rejects
    // null array members at runtime.
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const projectIds = [
      ...new Set(rows.map((r) => r.projectId).filter((id): id is string => !!id)),
    ];

    const [users, projects] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    const auditLogs: EnrichedAuditLog[] = rows.map((log) => {
      // Gateway-shape rows are emitted under the `gateway.<resource>.<verb>`
      // dotted naming convention; the `gateway.` prefix is the load-bearing
      // discriminator (also documented for SIEM scoping via LIKE 'gateway.%').
      // Presence of targetKind alone is not a safe signal — platform features
      // could in principle add their own target tracking later.
      const isGateway = log.action.startsWith("gateway.");
      return {
        id: log.id,
        createdAt: fromDate(log.createdAt),
        userId: log.userId,
        organizationId: log.organizationId,
        projectId: log.projectId,
        action: log.action,
        payload: isGateway ? (log.after ?? log.before ?? null) : log.args,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        error: log.error,
        args: isGateway ? { before: log.before, after: log.after } : log.args,
        user: log.userId ? (userMap.get(log.userId) ?? null) : null,
        project: log.projectId ? (projectMap.get(log.projectId) ?? null) : null,
        source: isGateway ? "gateway" : "platform",
        targetKind: log.targetKind,
        targetId: log.targetId,
        before: log.before,
        after: log.after,
      };
    });

    return { auditLogs, totalCount };
  }
}

type MemberWithUserRecord = Prisma.OrganizationUserGetPayload<{
  include: {
    user: { include: { teamMemberships: { include: { team: true; assignedRole: true } } } };
  };
}>;

function memberWithUserFromRecord({
  user: { teamMemberships, ...user },
  ...member
}: MemberWithUserRecord): OrganizationMemberWithUser {
  return {
    ...organizationUserFromRecord(member),
    user: {
      ...userFromRecord(user),
      teamMemberships: teamMemberships.map(({ team, assignedRole, ...membership }) => ({
        ...teamUserFromRecord(membership),
        team: teamFromRecord(team),
        assignedRole: assignedRole === null ? null : customRoleFromRecord(assignedRole),
      })),
    },
  };
}

type FullyLoadedOrganizationRecord = Prisma.OrganizationGetPayload<{
  include: {
    members: true;
    teams: { include: { members: { include: { assignedRole: true } }; projects: true } };
  };
}>;

function fullyLoadedOrganizationFromRecord({
  members,
  teams,
  ...organization
}: FullyLoadedOrganizationRecord): FullyLoadedOrganization {
  return {
    ...organizationFromRecord(organization),
    members: members.map(organizationUserFromRecord),
    teams: teams.map(({ members: teamMembers, projects, ...team }) => ({
      ...teamFromRecord(team),
      projects: projects.map(projectFromRecord),
      members: teamMembers.map(({ assignedRole, ...teamMember }) => ({
        ...teamUserFromRecord(teamMember),
        assignedRole: assignedRole === null ? null : customRoleFromRecord(assignedRole),
      })),
    })),
  };
}

type MemberSummaryRecord = Omit<
  OrganizationMemberSummary,
  "disabledAt" | "createdAt" | "updatedAt"
> & {
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function memberSummaryFromRecord(record: MemberSummaryRecord): OrganizationMemberSummary {
  return {
    ...record,
    disabledAt: record.disabledAt && fromDate(record.disabledAt),
    createdAt: fromDate(record.createdAt),
    updatedAt: fromDate(record.updatedAt),
  };
}
