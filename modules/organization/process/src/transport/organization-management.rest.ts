import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  type OrganizationUserRole,
  type organizationManagementRestInviteSchema,
  type organizationManagementRestMemberSchema,
  type organizationManagementRestMemberTeamSchema,
  OrganizationApi,
  type OrganizationCaller,
  organizationManagementRestAccessBreakdownSchema,
  organizationManagementRestCreateInvitesSchema,
  organizationManagementRestCreatedInvitesSchema,
  organizationManagementRestInviteIdParamsSchema,
  organizationManagementRestInviteListSchema,
  organizationManagementRestListMembersQuerySchema,
  organizationManagementRestMemberListSchema,
  organizationManagementRestMemberWithTeamsSchema,
  organizationManagementRestSettingsSchema,
  organizationManagementRestStoredTeamAssignmentSchema,
  organizationManagementRestSuccessSchema,
  organizationManagementRestUpdateMemberSchema,
  organizationManagementRestUpdateSchema,
  organizationManagementRestUpdatedMemberSchema,
  organizationManagementRestUserIdParamsSchema,
} from "@langwatch/organization-contract";
/** `/api/organization`: management surface wiring with implied organization credential. */
import { toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import { getDefaultTeamRoleForOrganizationRole } from "../rules/member-role-constraints.rules.ts";

/**
 * Whether the credential's organization holds the Enterprise plan this
 * family requires, resolved once per request after authentication and after
 * the permission check — the ordering the pre-conversion middleware held.
 */
export const organizationManagementEnterpriseGate = defineRestMiddleware(
  "organizationManagementEnterpriseGate",
  z.object({}),
);

/** A wire date field the way every app answer carries it: an `Instant`, converted here once. */

/** The member the organizationKey door hands over as `actor`; null for a service key. */
const deriveCaller = (actor: { type: string; id?: string } | null): OrganizationCaller | null =>
  actor && actor.type === "user" && actor.id ? { id: actor.id } : null;

const memberWire = (member: {
  userId: string;
  role: string;
  disabledAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
  user: { id: string; name: string | null; email: string | null };
}) => ({
  userId: member.userId,
  role: member.role as z.infer<typeof organizationManagementRestMemberSchema>["role"],
  disabled: member.disabledAt !== null,
  disabledAt: member.disabledAt ? toDate(member.disabledAt) : null,
  createdAt: toDate(member.createdAt),
  updatedAt: toDate(member.updatedAt),
  user: member.user,
});

/** The invite row fields this family reads, loosely typed against whatever the app hands back. */
interface InviteRow {
  id: string;
  email: string;
  role: string;
  status: string;
  expiration: Date | null;
  inviteCode: string;
  teamAssignments: unknown;
  teamIds: string;
  createdAt: Date;
}

/**
 * The invite's team assignments in the one shape POST accepts, whichever of
 * the two storage forms the row carries: explicit assignments, or the legacy
 * comma-separated team ids that imply the organization role's default.
 */
const inviteTeams = (invite: InviteRow) => {
  if (Array.isArray(invite.teamAssignments)) {
    return z
      .array(organizationManagementRestStoredTeamAssignmentSchema.nullable().catch(null))
      .catch([])
      .parse(invite.teamAssignments)
      .filter((assignment) => assignment !== null)
      .map((assignment) => ({
        teamId: assignment.teamId,
        role: assignment.role,
        customRoleId: assignment.customRoleId ?? null,
      }));
  }

  const defaultTeamRole = getDefaultTeamRoleForOrganizationRole(
    invite.role as OrganizationUserRole,
  );
  return invite.teamIds
    .split(",")
    .map((teamId) => teamId.trim())
    .filter(Boolean)
    .map((teamId) => ({ teamId, role: defaultTeamRole as string, customRoleId: null }));
};

const inviteWire = (
  invite: InviteRow,
  inviteUrl: string,
): z.infer<typeof organizationManagementRestInviteSchema> => ({
  id: invite.id,
  email: invite.email,
  role: invite.role as z.infer<typeof organizationManagementRestInviteSchema>["role"],
  status: invite.status,
  expiration: invite.expiration,
  inviteCode: invite.inviteCode,
  inviteUrl,
  teams: inviteTeams(invite),
  createdAt: invite.createdAt,
});

/** The team's role in the shape `createInvitations` accepts: built-in, or `custom:<id>`. */
const requestedTeamRole = (team: { role: string; customRoleId?: string | undefined }) =>
  team.role === "CUSTOM" && team.customRoleId
    ? (`custom:${team.customRoleId}` as const)
    : (team.role as "ADMIN" | "MEMBER" | "VIEWER");

export const organizationManagementRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<OrganizationApi>;
}> = defineRestRouter(OrganizationApi)
  .withNamespace("organization")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")

  .get("/", "getOrganization")
  .withPermission("organization:view")
  .withOutput(organizationManagementRestSettingsSchema)
  .withDocs({
    tags: ["Organization"],
    description:
      "Read the organization profile: name, slug, support contact, presence and trace sharing settings, and the S3 storage shape. The single sign-on fields and the S3 secret are never returned.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(({ app, scope }) => app.getSettings({ organizationId: scope.id }))

  .patch("/", "updateOrganization")
  .withPermission("organization:manage")
  .withInput(organizationManagementRestUpdateSchema)
  .withOutput(organizationManagementRestSettingsSchema)
  .withDocs({
    tags: ["Organization"],
    description:
      "Update the organization profile. Partial: only the fields present are written, and the response is exactly what a subsequent GET returns.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    await app.updateSettings({ organizationId: scope.id, ...input });

    return app.getSettings({ organizationId: scope.id });
  })

  .get("/members", "listOrganizationMembers")
  .withPermission("organization:view")
  .withQuery(organizationManagementRestListMembersQuerySchema)
  .withOutput(organizationManagementRestMemberListSchema)
  .withDocs({
    tags: ["Members"],
    description:
      "List the organization's members with their organization role and disabled status. Disabled members are included only when includeDisabled=true.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    const { members, totalCount } = await app.listMembers({
      organizationId: scope.id,
      includeDisabled: input.includeDisabled ?? false,
      offset: input.offset ?? 0,
      limit: input.limit ?? 50,
    });

    return { members: members.map(memberWire), totalCount };
  })

  .get("/members/:userId", "getOrganizationMember")
  .withPermission("organization:view")
  .withParams(organizationManagementRestUserIdParamsSchema)
  .withOutput(organizationManagementRestMemberWithTeamsSchema)
  .withDocs({
    tags: ["Members"],
    description:
      "Read one member, including the teams they reach through team-scoped role bindings. Personal workspaces are not listed: they are not access an administrator manages.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    const member = await app.getMember({ organizationId: scope.id, userId: input.userId });

    return {
      ...memberWire(member),
      teams: member.teams.map((team) => ({
        ...team,
        role: team.role as z.infer<typeof organizationManagementRestMemberTeamSchema>["role"],
      })),
    };
  })

  .get("/members/:userId/access", "getOrganizationMemberAccess")
  .withPermission("organization:manage")
  .withParams(organizationManagementRestUserIdParamsSchema)
  .withOutput(organizationManagementRestAccessBreakdownSchema)
  .withDocs({
    tags: ["Members"],
    description:
      "The member's full access breakdown: organization role, group memberships with their bindings, and direct bindings, each with the permissions it grants and the scope it grants them on.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    // 404 before disclosure: the breakdown call itself never fails on an
    // unknown user, it just answers emptily, which would read as a member
    // with no access rather than no member.
    const member = await app.getMember({ organizationId: scope.id, userId: input.userId });

    return app.getMemberAccessBreakdown({
      organizationId: scope.id,
      userId: member.userId,
      userName: member.user.name,
      userEmail: member.user.email,
    });
  })

  .patch("/members/:userId", "updateOrganizationMember")
  .withPermission("organization:manage")
  .withParams(organizationManagementRestUserIdParamsSchema)
  .withInput(organizationManagementRestUpdateMemberSchema)
  .withOutput(organizationManagementRestUpdatedMemberSchema)
  .withDocs({
    tags: ["Members"],
    description:
      "Change a member's organization role, or disable / re-enable their membership. Send exactly one of role or disabled. Re-enabling consumes a seat, so it is checked against the plan.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(async ({ app, input, scope, actor }) => {
    const caller: OrganizationCaller | null = deriveCaller(actor);

    let teamsLeftWithoutAdmin: { id: string; name: string }[] | undefined;
    if (input.role !== undefined) {
      const result = await app.changeMemberRole(
        {
          organizationId: scope.id,
          userId: input.userId,
          role: input.role as OrganizationUserRole,
          ...(caller ? { planUser: caller } : {}),
        },
        caller,
      );
      teamsLeftWithoutAdmin = [...result.teamsLeftWithoutAdmin];
    } else {
      await app.setMemberDisabled(
        { organizationId: scope.id, userId: input.userId, disabled: input.disabled === true },
        caller,
      );
    }

    const member = await app.getMember({ organizationId: scope.id, userId: input.userId });

    return {
      ...memberWire(member),
      ...(teamsLeftWithoutAdmin && teamsLeftWithoutAdmin.length > 0
        ? { teamsLeftWithoutAdmin }
        : {}),
    };
  })

  .delete("/members/:userId", "removeOrganizationMember")
  .withPermission("organization:manage")
  .withParams(organizationManagementRestUserIdParamsSchema)
  .withOutput(organizationManagementRestSuccessSchema)
  .withDocs({
    tags: ["Members"],
    description:
      "Remove a member from the organization and every team in it. The member the credential acts as cannot remove themselves.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(async ({ app, input, scope, actor }) => {
    await app.deleteMember({ organizationId: scope.id, userId: input.userId }, deriveCaller(actor));

    return { success: true as const };
  })

  .get("/invites", "listOrganizationInvites")
  .withPermission("organization:manage")
  .withOutput(organizationManagementRestInviteListSchema)
  .withDocs({
    tags: ["Invites"],
    description:
      "List pending invites. Each carries its invite code and acceptance link, because a provisioning run with no email provider still has to hand the person something to open.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(async ({ app, scope }) => {
    const invitations = await app.listPendingInvitations({ organizationId: scope.id });

    return { invites: invitations.map((invite) => inviteWire(invite, invite.inviteUrl)) };
  })

  .post("/invites", "createOrganizationInvites")
  .withPermission("organization:manage")
  .withInput(organizationManagementRestCreateInvitesSchema)
  .withOutput(organizationManagementRestCreatedInvitesSchema)
  .withStatus(201)
  .withDocs({
    tags: ["Invites"],
    description:
      "Create up to 50 invites in one batch, each with team assignments that may carry a custom role. Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than silently granting less than was asked. emailNotSent reports, per invite, whether the invite email could be delivered.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(async ({ app, input, scope, actor }) => {
    const caller: OrganizationCaller | null = deriveCaller(actor);

    const created = await app.createInvitations(
      {
        organizationId: scope.id,
        // Strict, as this family's published contract says above: a
        // provisioning caller naming a team that is not in the organization is
        // refused by name rather than told its batch succeeded with nobody in
        // it.
        validation: "strict",
        invites: input.invites.map((invite) => ({
          email: invite.email,
          role: invite.role as OrganizationUserRole,
          teams: invite.teams.map((team) => ({
            teamId: team.teamId,
            role: requestedTeamRole(team),
          })),
        })),
      },
      // A service key acts as nobody; invites it creates are attributed to
      // the organization feature itself for the analytics event this raises.
      caller ?? { id: SYSTEM_ACTORS.organizationService },
    );

    return {
      invites: created.map((entry) => ({
        ...inviteWire(entry.invite, entry.inviteUrl),
        emailNotSent: entry.emailNotSent,
      })),
    };
  })

  .delete("/invites/:inviteId", "revokeOrganizationInvite")
  .withPermission("organization:manage")
  .withParams(organizationManagementRestInviteIdParamsSchema)
  .withOutput(organizationManagementRestSuccessSchema)
  .withDocs({
    tags: ["Invites"],
    description:
      "Revoke a pending invite. An invite id from another organization, or one already revoked, answers 404.",
  })
  .withMiddleware(organizationManagementEnterpriseGate)
  .handle(async ({ app, input, scope }) => {
    await app.revokeInvitation({ organizationId: scope.id, inviteId: input.inviteId });

    return { success: true as const };
  })

  .build();
