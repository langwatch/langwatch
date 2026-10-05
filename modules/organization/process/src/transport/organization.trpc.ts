/** Server-side organization procedures: permissions and handlers forward to application. */

import type { AuthzDeclaration } from "@langwatch/api/access";
import {
  defineTrpcFact,
  defineTrpcRouter,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import {
  assignsOrganizationCustomRole,
  OrganizationApi,
  organizationTrpc,
  type CustomRole,
  type EnrichedAuditLog,
  type FullyLoadedOrganization,
  type Organization,
  type OrganizationAuditLogPage,
  type OrganizationCaller,
  type OrganizationMemberDirectory,
  type OrganizationMemberRecord,
  type OrganizationMemberUser,
  type OrganizationUser,
  type OrganizationWithMembersAndTheirTeams,
  type ProjectRow,
  type Team,
  type TeamUser,
  type User,
} from "@langwatch/organization-contract";
import { toDate } from "@langwatch/time";
import { z } from "zod";

/** Assigning a custom team role is Enterprise; built-in roles grant on every plan. */
export const customRoleGate = { feature: "RBAC", when: assignsOrganizationCustomRole };

/** The signed-in person as the process's session carries them, beside their id. */
export const organizationSessionPersonFact = defineTrpcFact(
  "organizationSessionPerson",
  z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
);

/** What one session person looks like once the fact has been parsed. */
type SessionPerson = Readonly<{ name: string | null; email: string | null }> | null;

/**
 * The one opt-out this namespace makes, and the same sentence for all three
 * procedures that make it: each runs before or across membership, so there is
 * no scope to check and no permission the caller could hold.
 */
export const BEFORE_MEMBERSHIP = {
  reason:
    "runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite",
} as const;

/** `organization:manage`, resolved from the team the change addresses. */
const MANAGE_VIA_TEAM: AuthzDeclaration = {
  kind: "permission",
  permission: "organization:manage",
  via: "teamId",
};

/**
 * `auditLog:view` at the ORGANIZATION tier, always — `projectId` is only an
 * optional FILTER here, so inferring the tier would leave the anchoring
 * organization unauthorized; the extra project-tier question is asked in the application.
 */
const AUDIT_LOG_VIEW: AuthzDeclaration = {
  kind: "permission",
  permission: "auditLog:view",
  via: "organizationId",
};

/** Who is asking, as every write on this namespace is attributed. */
export function callerOf(actor: TrpcHandlerActor, person: SessionPerson): OrganizationCaller {
  return { id: actor.id, name: person?.name ?? null, email: person?.email ?? null };
}

export const organizationTrpcTransport: TrpcRouterDeclaration<
  OrganizationApi,
  typeof organizationTrpc
> = defineTrpcRouter(OrganizationApi, organizationTrpc)
  .procedure("createAndAssign")
  .withFacts(organizationSessionPersonFact)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(async ({ app, input, actor }, person) => {
    const caller = callerOf(actor, person);
    const result = await app.createAndAssign(
      {
        orgName: input.orgName,
        phoneNumber: input.phoneNumber,
        signUpData: input.signUpData,
        primaryIntent: input.primaryIntent,
        userDisplayName: caller.name,
      },
      caller,
    );

    return { success: true as const, organization: result.organization, team: result.team };
  })

  // The self-removal guard lives in the service: it refuses with
  // `cannot_remove_self`, which the client renders its own copy for.
  .procedure("deleteMember")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }, person) => {
    await app.deleteMember(input, callerOf(actor, person));

    return { success: true as const };
  })

  /**
   * Disables or re-enables a membership so an organization can reconcile down
   * to the seats its licence covers. See seat-reconciliation.feature.
   */
  .procedure("setMemberDisabled")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }, person) => {
    await app.setMemberDisabled(input, callerOf(actor, person));

    return { success: true as const };
  })

  /** The shell's first read: every organization this person can reach. */
  .procedure("getAll")
  .withFacts(organizationSessionPersonFact)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, input, actor }, person) =>
    app
      .listVisibleOrganizations({ isDemo: input?.isDemo ?? false }, callerOf(actor, person))
      .then((organizations) => organizations.map(fullyLoadedOrganizationOnWire)),
  )

  /** The shell's scope skeleton: what every page resolves its scope against. */
  .procedure("getScopeGraph")
  .withFacts(organizationSessionPersonFact)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, actor }, person) => app.getScopeGraph(callerOf(actor, person)))

  .procedure("update")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    // The stored secret is never sent to the form: a blank one beside an
    // endpoint leaves it unchanged, and blank everywhere clears it.
    await app.updateSettings(
      {
        organizationId: input.organizationId,
        name: input.name,
        s3Endpoint: input.s3Endpoint ?? null,
        s3AccessKeyId: input.s3AccessKeyId ?? null,
        s3SecretAccessKey: input.s3SecretAccessKey || (input.s3Endpoint ? void 0 : null),
        s3Bucket: input.s3Bucket,
        presenceEnabled: input.presenceEnabled,
        traceSharingEnabled: input.traceSharingEnabled,
        supportContact: input.supportContact,
        primaryIntent: input.primaryIntent,
      },
      { id: actor.id },
    );

    return { success: true as const };
  })

  /**
   * Stays at `organization:view`: non-admin pickers (annotation assignment,
   * trace participants, group dialogs) enumerate members by name. Addresses
   * are redacted for a caller who cannot administer, in the application.
   */
  .procedure("getOrganizationWithMembersAndTheirTeams")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:view")
  .handle(({ app, input, actor }, person) =>
    app
      .getOrganizationWithMembersForPicker(
        {
          organizationId: input.organizationId,
          includeDeactivated: input.includeDeactivated ?? false,
        },
        callerOf(actor, person),
      )
      .then(memberDirectoryOnWire),
  )

  /** The Directory is an `organization:manage` page; so are its badges. */
  .procedure("getDirectoryCounts")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.getDirectoryCounts(input))

  /**
   * `organization:manage`, not `view`: one member's full record - role
   * assignments, team memberships - is an admin-surface read.
   */
  .procedure("getMemberById")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(({ app, input, actor }, person) =>
    app.getMemberOrRefuse(input, callerOf(actor, person)).then(memberRecordOnWire),
  )

  /** Bounded by the organization's own membership, never a caller-supplied id list. */
  .procedure("getMemberProvenance")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.getMemberProvenance(input))

  .procedure("updateTeamMemberRole")
  .withEntitlement("enterprise", customRoleGate)
  .withFacts(organizationSessionPersonFact)
  .withPermission(MANAGE_VIA_TEAM)
  .handle(async ({ app, input, actor }, person) => {
    await app.changeTeamMemberRole(input, callerOf(actor, person));

    return { success: true as const };
  })

  /**
   * `organization:manage`, not `view`: the full member list with addresses is
   * admin-surface personal data. A picker that needs names uses the read
   * above, which redacts them.
   */
  .procedure("getAllOrganizationMembers")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app
      .getAllMembers({ organizationId: input.organizationId })
      .then((users) => users.map(memberUserOnWire)),
  )

  .procedure("updateMemberRole")
  .withEntitlement("enterprise", customRoleGate)
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }, person) => {
    const caller = callerOf(actor, person);
    // The whole orchestration - personal-workspace assertion, shared-team
    // scoping, seat classification - lives in the service, so the REST
    // surface runs the same rules; the custom-role plan is declared above.
    const { teamsLeftWithoutAdmin } = await app.changeMemberRole(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        teamRoleUpdates: input.teamRoleUpdates,
        planUser: caller,
      },
      caller,
    );

    // Reported rather than refused: correcting a seat down to Viewer can take
    // away a shared team's only team-scoped admin, which is allowed because
    // organization admins administer every shared team anyway.
    return { success: true as const, teamsLeftWithoutAdmin };
  })

  .procedure("getAuditLogs")
  .withEntitlement("enterprise", { feature: "AUDIT_LOGS" })
  .withFacts(organizationSessionPersonFact)
  .withPermission(AUDIT_LOG_VIEW)
  .handle(({ app, input, actor }, person) =>
    app.readAuditLogs(input, callerOf(actor, person)).then(auditLogPageOnWire),
  )
  .build();

function memberUserOnWire(user: User): OrganizationMemberUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    deactivatedAt: user.deactivatedAt && toDate(user.deactivatedAt),
  };
}

function auditLogPageOnWire(page: {
  auditLogs: EnrichedAuditLog[];
  totalCount: number;
}): OrganizationAuditLogPage {
  return {
    ...page,
    auditLogs: page.auditLogs.map((log) => ({ ...log, createdAt: toDate(log.createdAt) })),
  };
}

function organizationOnWire(organization: Organization) {
  return {
    ...organization,
    createdAt: toDate(organization.createdAt),
    updatedAt: toDate(organization.updatedAt),
    sentPlanLimitAlert: organization.sentPlanLimitAlert && toDate(organization.sentPlanLimitAlert),
    licenseExpiresAt: organization.licenseExpiresAt && toDate(organization.licenseExpiresAt),
    licenseLastValidatedAt:
      organization.licenseLastValidatedAt && toDate(organization.licenseLastValidatedAt),
  };
}

function organizationUserOnWire(member: OrganizationUser) {
  return {
    ...member,
    createdAt: toDate(member.createdAt),
    updatedAt: toDate(member.updatedAt),
    disabledAt: member.disabledAt && toDate(member.disabledAt),
  };
}

function teamOnWire(team: Team) {
  return {
    ...team,
    createdAt: toDate(team.createdAt),
    updatedAt: toDate(team.updatedAt),
    archivedAt: team.archivedAt && toDate(team.archivedAt),
  };
}

function teamUserOnWire(membership: TeamUser & { assignedRole?: CustomRole | null }) {
  return {
    ...membership,
    createdAt: toDate(membership.createdAt),
    updatedAt: toDate(membership.updatedAt),
    assignedRole: membership.assignedRole && {
      ...membership.assignedRole,
      createdAt: toDate(membership.assignedRole.createdAt),
      updatedAt: toDate(membership.assignedRole.updatedAt),
    },
  };
}

function projectOnWire({ apiKey: _withheld, ...project }: ProjectRow) {
  return {
    ...project,
    createdAt: toDate(project.createdAt),
    updatedAt: toDate(project.updatedAt),
    archivedAt: project.archivedAt && toDate(project.archivedAt),
    lastCodingAgentSessionAt:
      project.lastCodingAgentSessionAt && toDate(project.lastCodingAgentSessionAt),
    lastCodingAgentPullRequestAt:
      project.lastCodingAgentPullRequestAt && toDate(project.lastCodingAgentPullRequestAt),
  };
}

function fullyLoadedOrganizationOnWire(organization: FullyLoadedOrganization) {
  return {
    ...organizationOnWire(organization),
    members: organization.members.map(organizationUserOnWire),
    teams: organization.teams.map((team) => ({
      ...teamOnWire(team),
      projects: team.projects.map(projectOnWire),
      members: team.members.map(teamUserOnWire),
    })),
  };
}

function memberRecordOnWire(
  member: OrganizationWithMembersAndTheirTeams["members"][number],
): OrganizationMemberRecord {
  return {
    userId: member.userId,
    organizationId: member.organizationId,
    role: member.role,
    createdAt: toDate(member.createdAt),
    updatedAt: toDate(member.updatedAt),
    departmentId: member.departmentId,
    disabledAt: member.disabledAt && toDate(member.disabledAt),
    user: {
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image,
      emailVerified: member.user.emailVerified,
      deactivatedAt: member.user.deactivatedAt && toDate(member.user.deactivatedAt),
    },
  };
}

function memberDirectoryOnWire(
  organization: OrganizationWithMembersAndTheirTeams,
): OrganizationMemberDirectory {
  return {
    id: organization.id,
    name: organization.name,
    members: organization.members.map((member) => ({
      userId: member.userId,
      organizationId: member.organizationId,
      role: member.role,
      createdAt: toDate(member.createdAt),
      updatedAt: toDate(member.updatedAt),
      departmentId: member.departmentId,
      disabledAt: member.disabledAt && toDate(member.disabledAt),
      user: {
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        image: member.user.image,
        deactivatedAt: member.user.deactivatedAt && toDate(member.user.deactivatedAt),
      },
    })),
  };
}
