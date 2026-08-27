/**
 * The organization family's handlers: the profile, its members and its
 * invites. Each takes the request context and the validated input the
 * registration in `app.ts` bound to it, and answers the wire shape declared
 * beside it in `wire.ts`. Services arrive on context; validated path, query
 * and body fields arrive together as the second argument.
 */

import type { z } from "zod";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import { emitManagementAudit } from "~/server/api/management/audit";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { buildInviteAcceptUrl } from "~/server/invites/invite-link";
import {
  actorUserIdOf,
  type createInvitesSchema,
  inviteWire,
  type listMembersQuerySchema,
  memberWire,
  type OrganizationContext,
  organizationOf,
  rethrowSeatLimit,
  type updateMemberSchema,
  type updateOrganizationSchema,
  type userIdParamsSchema,
} from "./wire";

// ── handlers ─────────────────────────────────────────────────────────────────

export const getOrganizationHandler = async (c: OrganizationContext) =>
  c.get("organizations").getSettings(organizationOf(c).id);

export const updateOrganizationHandler = async (
  c: OrganizationContext,
  input: z.infer<typeof updateOrganizationSchema>,
) => {
  const organization = organizationOf(c);
  await c.get("organizations").updateSettings({
    organizationId: organization.id,
    ...input,
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.organization.update",
    args: { fields: Object.keys(input) },
  });
  return c.get("organizations").getSettings(organization.id);
};

export const listMembersHandler = async (
  c: OrganizationContext,
  input: z.infer<typeof listMembersQuerySchema>,
) => {
  const organizationId = organizationOf(c).id;
  const { members, totalCount } = await c.get("organizations").listMembers({
    organizationId,
    includeDisabled: input.includeDisabled ?? false,
    offset: input.offset ?? 0,
    limit: input.limit ?? 50,
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
  c: OrganizationContext,
  input: z.infer<typeof userIdParamsSchema>,
) => {
  const organizationId = organizationOf(c).id;
  const member = await c.get("organizations").getMember({
    organizationId,
    userId: input.userId,
  });
  emitManagementAudit({
    c,
    organizationId,
    action: "management.organizationMember.read",
    args: { userId: input.userId },
  });
  return { ...memberWire(member), teams: member.teams };
};

/** The role branch of the member PATCH; seat overflow renamed at the seam. */
export const applyMemberRoleChange = async ({
  organizations,
  organizationId,
  userId,
  role,
  actorUserId,
}: {
  organizations: OrganizationService;
  organizationId: string;
  userId: string;
  role: OrganizationUserRole;
  actorUserId: string | null;
}): Promise<Array<{ id: string; name: string }> | undefined> => {
  try {
    const result = await organizations.changeMemberRole({
      organizationId,
      userId,
      role,
      currentUserId: actorUserId,
      ...(actorUserId ? { planUser: { id: actorUserId } } : {}),
    });
    return result.teamsLeftWithoutAdmin.length > 0 ? result.teamsLeftWithoutAdmin : undefined;
  } catch (error) {
    return rethrowSeatLimit(error);
  }
};

/** The disabled branch of the member PATCH; same seat-limit seam. */
export const applyMemberDisabledChange = async ({
  organizations,
  organizationId,
  userId,
  disabled,
  actorUserId,
}: {
  organizations: OrganizationService;
  organizationId: string;
  userId: string;
  disabled: boolean;
  actorUserId: string | null;
}): Promise<void> => {
  try {
    await organizations.setMemberDisabled({
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
  c: OrganizationContext,
  input: z.infer<typeof userIdParamsSchema> & z.infer<typeof updateMemberSchema>,
) => {
  const organization = organizationOf(c);
  const actorUserId = actorUserIdOf(c);
  const organizations = c.get("organizations");

  const teamsLeftWithoutAdmin =
    input.role !== undefined
      ? await applyMemberRoleChange({
          organizations,
          organizationId: organization.id,
          userId: input.userId,
          role: input.role,
          actorUserId,
        })
      : await applyMemberDisabledChange({
          organizations,
          organizationId: organization.id,
          userId: input.userId,
          disabled: input.disabled === true,
          actorUserId,
        }).then(() => undefined);

  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.member.update",
    args: { ...input },
  });

  const member = await organizations.getMember({
    organizationId: organization.id,
    userId: input.userId,
  });
  return {
    ...memberWire(member),
    ...(teamsLeftWithoutAdmin ? { teamsLeftWithoutAdmin } : {}),
  };
};

export const removeMemberHandler = async (
  c: OrganizationContext,
  input: z.infer<typeof userIdParamsSchema>,
) => {
  const organization = organizationOf(c);
  await c.get("organizations").deleteMember({
    organizationId: organization.id,
    userId: input.userId,
    actingUserId: actorUserIdOf(c),
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.member.delete",
    args: { userId: input.userId },
  });
  return { success: true as const };
};

export const memberAccessHandler = async (
  c: OrganizationContext,
  input: z.infer<typeof userIdParamsSchema>,
) => {
  const organization = organizationOf(c);
  // 404 before disclosure: the breakdown call itself never fails on an
  // unknown user, it just answers emptily, which would read as a member with
  // no access rather than no member.
  const member = await c.get("organizations").getMember({
    organizationId: organization.id,
    userId: input.userId,
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.organizationMember.readAccess",
    args: { userId: input.userId },
  });
  return c.get("authz").getAccessBreakdown({
    organizationId: organization.id,
    userId: member.userId,
    userName: member.user.name,
    userEmail: member.user.email,
  });
};

export const listInvitesHandler = async (c: OrganizationContext) => {
  const organizationId = organizationOf(c).id;
  const invites = await c.get("invites").listInvites({
    organizationId,
  });
  // The invite wire carries the addresses plus the acceptance code and link,
  // so reading the list discloses more than the member directory read above
  // and leaves the same trace.
  emitManagementAudit({
    c,
    organizationId,
    action: "management.invite.list",
    args: { returned: invites.length },
  });
  return { invites: invites.map(inviteWire) };
};

export const createInvitesHandler = async (
  c: OrganizationContext,
  input: z.infer<typeof createInvitesSchema>,
) => {
  const organization = organizationOf(c);
  const actorUserId = actorUserIdOf(c);
  try {
    const result = await c.get("invites").createInvites({
      organizationId: organization.id,
      invites: input.invites,
      ...(actorUserId ? { user: { id: actorUserId } } : {}),
      validation: "strict",
    });
    // The invitee addresses are the subject of the record, not incidental
    // context: "who was granted a way into this organization" is the question
    // this entry exists to answer, and an invite id answers it only for as
    // long as the invite row survives. The record adds no exposure, since the
    // same addresses are listed by `GET /api/organization/invites` to the same
    // organization-scoped credentials.
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

export const revokeInviteHandler = async (c: OrganizationContext, input: { id: string }) => {
  const organization = organizationOf(c);
  await c.get("invites").revokeInvite({
    organizationId: organization.id,
    inviteId: input.id,
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.invite.delete",
    args: { inviteId: input.id },
  });
  return { success: true as const };
};
