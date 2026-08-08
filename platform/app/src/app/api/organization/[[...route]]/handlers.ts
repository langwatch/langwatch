/**
 * The organization family's handlers: the profile, its members and its
 * invites. Each takes the request context and the validated input the
 * registration in `app.ts` bound to it, and answers the wire shape declared
 * beside it in `wire.ts`.
 */
import type { OrganizationUserRole } from "@prisma/client";
import type { Context } from "hono";
import type { z } from "zod";
import { emitManagementAudit } from "~/server/api/management/audit";
import { buildInviteAcceptUrl } from "~/server/invites/invite-link";
import {
  actorUserIdOf,
  type createInvitesSchema,
  inviteWire,
  type listMembersQuerySchema,
  memberWire,
  type OrganizationFamilyApp,
  organizationOf,
  rethrowSeatLimit,
  type updateMemberSchema,
  type updateOrganizationSchema,
  type userIdParamsSchema,
} from "./wire";

// ── handlers ─────────────────────────────────────────────────────────────────

export const getOrganizationHandler = async (
  c: Context,
  { app }: { app: OrganizationFamilyApp },
) => app.organizations.getSettings(organizationOf(c).id);

export const updateOrganizationHandler = async (
  c: Context,
  {
    input,
    app,
  }: {
    input: z.infer<typeof updateOrganizationSchema>;
    app: OrganizationFamilyApp;
  },
) => {
  const organization = organizationOf(c);
  await app.organizations.updateSettings({
    organizationId: organization.id,
    ...input,
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.organization.update",
    args: { fields: Object.keys(input) },
  });
  return app.organizations.getSettings(organization.id);
};

export const listMembersHandler = async (
  c: Context,
  {
    query,
    app,
  }: {
    query: z.infer<typeof listMembersQuerySchema>;
    app: OrganizationFamilyApp;
  },
) => {
  const organizationId = organizationOf(c).id;
  const { members, totalCount } = await app.organizations.listMembers({
    organizationId,
    includeDisabled: query.includeDisabled ?? false,
    offset: query.offset ?? 0,
    limit: query.limit ?? 50,
  });
  // The member wire carries names and addresses, so a credential enumerating
  // the directory leaves the same trace a write does.
  emitManagementAudit({
    c,
    organizationId,
    action: "management.organizationMember.list",
    args: { returned: members.length, totalCount },
  });
  return { members: members.map(memberWire), totalCount };
};

export const getMemberHandler = async (
  c: Context,
  {
    params,
    app,
  }: {
    params: z.infer<typeof userIdParamsSchema>;
    app: OrganizationFamilyApp;
  },
) => {
  const organizationId = organizationOf(c).id;
  const member = await app.organizations.getMember({
    organizationId,
    userId: params.userId,
  });
  emitManagementAudit({
    c,
    organizationId,
    action: "management.organizationMember.read",
    args: { userId: params.userId },
  });
  return { ...memberWire(member), teams: member.teams };
};

/** The role branch of the member PATCH; seat overflow renamed at the seam. */
export const applyMemberRoleChange = async ({
  app,
  organizationId,
  userId,
  role,
  actorUserId,
}: {
  app: OrganizationFamilyApp;
  organizationId: string;
  userId: string;
  role: OrganizationUserRole;
  actorUserId: string | null;
}): Promise<Array<{ id: string; name: string }> | undefined> => {
  try {
    const result = await app.organizations.changeMemberRole({
      organizationId,
      userId,
      role,
      currentUserId: actorUserId ?? "",
      ...(actorUserId ? { planUser: { id: actorUserId } } : {}),
    });
    return result.teamsLeftWithoutAdmin.length > 0
      ? result.teamsLeftWithoutAdmin
      : undefined;
  } catch (error) {
    return rethrowSeatLimit(error);
  }
};

/** The disabled branch of the member PATCH; same seat-limit seam. */
export const applyMemberDisabledChange = async ({
  app,
  organizationId,
  userId,
  disabled,
  actorUserId,
}: {
  app: OrganizationFamilyApp;
  organizationId: string;
  userId: string;
  disabled: boolean;
  actorUserId: string | null;
}): Promise<void> => {
  try {
    await app.organizations.setMemberDisabled({
      organizationId,
      userId,
      disabled,
      actingUser: actorUserId ? { id: actorUserId } : null,
    });
  } catch (error) {
    rethrowSeatLimit(error);
  }
};

export const updateMemberHandler = async (
  c: Context,
  {
    params,
    input,
    app,
  }: {
    params: z.infer<typeof userIdParamsSchema>;
    input: z.infer<typeof updateMemberSchema>;
    app: OrganizationFamilyApp;
  },
) => {
  const organization = organizationOf(c);
  const actorUserId = actorUserIdOf(c);

  const teamsLeftWithoutAdmin =
    input.role !== undefined
      ? await applyMemberRoleChange({
          app,
          organizationId: organization.id,
          userId: params.userId,
          role: input.role,
          actorUserId,
        })
      : await applyMemberDisabledChange({
          app,
          organizationId: organization.id,
          userId: params.userId,
          disabled: input.disabled === true,
          actorUserId,
        }).then(() => undefined);

  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.member.update",
    args: { userId: params.userId, ...input },
  });

  const member = await app.organizations.getMember({
    organizationId: organization.id,
    userId: params.userId,
  });
  return {
    ...memberWire(member),
    ...(teamsLeftWithoutAdmin ? { teamsLeftWithoutAdmin } : {}),
  };
};

export const removeMemberHandler = async (
  c: Context,
  {
    params,
    app,
  }: {
    params: z.infer<typeof userIdParamsSchema>;
    app: OrganizationFamilyApp;
  },
) => {
  const organization = organizationOf(c);
  await app.organizations.deleteMember({
    organizationId: organization.id,
    userId: params.userId,
    actingUserId: actorUserIdOf(c),
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.member.delete",
    args: { userId: params.userId },
  });
  return { success: true as const };
};

export const memberAccessHandler = async (
  c: Context,
  {
    params,
    app,
  }: {
    params: z.infer<typeof userIdParamsSchema>;
    app: OrganizationFamilyApp;
  },
) => {
  const organization = organizationOf(c);
  // 404 before disclosure: the breakdown call itself never fails on an
  // unknown user, it just answers emptily, which would read as a member with
  // no access rather than no member.
  const member = await app.organizations.getMember({
    organizationId: organization.id,
    userId: params.userId,
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.organizationMember.readAccess",
    args: { userId: params.userId },
  });
  return app.roleBindings.getMyAccessBreakdown({
    organizationId: organization.id,
    userId: member.userId,
    userName: member.user.name,
    userEmail: member.user.email,
  });
};

export const listInvitesHandler = async (
  c: Context,
  { app }: { app: OrganizationFamilyApp },
) => {
  const invites = await app.invites.listInvites({
    organizationId: organizationOf(c).id,
  });
  return { invites: invites.map(inviteWire) };
};

export const createInvitesHandler = async (
  c: Context,
  {
    input,
    app,
  }: {
    input: z.infer<typeof createInvitesSchema>;
    app: OrganizationFamilyApp;
  },
) => {
  const organization = organizationOf(c);
  const actorUserId = actorUserIdOf(c);
  try {
    const result = await app.invites.createInvites({
      organizationId: organization.id,
      invites: input.invites,
      ...(actorUserId ? { user: { id: actorUserId } } : {}),
      validation: "strict",
    });
    emitManagementAudit({
      c,
      organizationId: organization.id,
      action: "management.invite.create",
      args: {
        emails: input.invites.map((invite) => invite.email),
        created: result.invites.map((entry) => entry.invite.id),
      },
    });
    return {
      invites: result.invites.map((entry) => ({
        ...inviteWire({
          ...entry.invite,
          inviteUrl: buildInviteAcceptUrl(entry.invite.inviteCode),
        }),
        emailNotSent: entry.emailNotSent,
      })),
    };
  } catch (error) {
    return rethrowSeatLimit(error);
  }
};

export const revokeInviteHandler = async (
  c: Context,
  { params, app }: { params: { id: string }; app: OrganizationFamilyApp },
) => {
  const organization = organizationOf(c);
  await app.invites.revokeInvite({
    organizationId: organization.id,
    inviteId: params.id,
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.invite.delete",
    args: { inviteId: params.id },
  });
  return { success: true as const };
};
