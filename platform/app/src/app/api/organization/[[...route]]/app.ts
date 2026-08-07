/**
 * The organization management REST family: the organization profile, its
 * members, and its invites, addressed with no {orgId} segment because the
 * organization is implied by the credential.
 *
 * Built on `@langwatch/api` through `createManagementService`, so every
 * endpoint declares its RBAC permission once and gets the SecuredApp policy
 * registration, the org-key authentication (throwing mode), the permission
 * check (403) and the Enterprise plan gate (402) in that order. Only the bare
 * alias paths reach the OpenAPI document; the dated and `latest` mounts serve
 * traffic with version headers.
 *
 * Terraform-shaped: reads return every field a write accepts (the SSO fields
 * and the S3 secret are deliberately not owned by this API), PATCH is partial,
 * and deletes of missing resources answer their family's stable 404 code.
 */
import type { BaseApp, VersionBuilder } from "@langwatch/api";
import {
  type Organization,
  OrganizationIntent,
  type OrganizationInvite,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import type { Context } from "hono";
import { z } from "zod";
import { emitManagementAudit } from "~/server/api/management/audit";
import { createManagementService } from "~/server/api/management/managed-service";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { MemberSeatLimitReachedError } from "~/server/app-layer/organizations/errors";
import { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import type { OrganizationMemberSummary } from "~/server/app-layer/organizations/repositories/organization.repository";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";
import { prisma } from "~/server/db";
import {
  InviteService,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
} from "~/server/invites/invite.service";
import { buildInviteAcceptUrl } from "~/server/invites/invite-link";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { RoleService } from "~/server/role/role.service";
import { RoleBindingService } from "~/server/role-bindings/role-binding.service";

const { service, guard } = createManagementService({
  name: "organization",
  basePath: "/api/organization",
  feature: "MANAGEMENT_API",
});

/** The provider context every handler in this family receives. */
type OrganizationFamilyApp = BaseApp & {
  organizations: OrganizationService;
  invites: InviteService;
  roleBindings: RoleBindingService;
};

type OrganizationVersion = VersionBuilder<OrganizationFamilyApp>;

// ── wire schemas ─────────────────────────────────────────────────────────────

const organizationSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  supportContact: z.string().nullable(),
  presenceEnabled: z.boolean(),
  traceSharingEnabled: z.boolean(),
  primaryIntent: z.nativeEnum(OrganizationIntent).nullable(),
  s3Endpoint: z.string().nullable(),
  s3AccessKeyId: z.string().nullable(),
  s3Bucket: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  supportContact: z.string().max(255).nullable().optional(),
  presenceEnabled: z.boolean().optional(),
  traceSharingEnabled: z.boolean().optional(),
  primaryIntent: z.nativeEnum(OrganizationIntent).nullable().optional(),
  s3Endpoint: z.string().max(2048).nullable().optional(),
  s3AccessKeyId: z.string().max(1024).nullable().optional(),
  /** Write-only: accepted here, never read back. */
  s3SecretAccessKey: z.string().max(1024).nullable().optional(),
  s3Bucket: z.string().max(1024).nullable().optional(),
});

const memberSchema = z.object({
  userId: z.string(),
  role: z.nativeEnum(OrganizationUserRole),
  disabled: z.boolean(),
  disabledAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  user: z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
});

const memberTeamSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().nullable(),
  customRoleName: z.string().nullable(),
});

const updateMemberSchema = z
  .object({
    role: z.nativeEnum(OrganizationUserRole).optional(),
    disabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const fields = [value.role, value.disabled].filter(
      (field) => field !== undefined,
    );
    if (fields.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Send exactly one of role or disabled",
      });
    }
  });

const memberWithTeamsSchema = memberSchema.extend({
  teams: z.array(memberTeamSchema),
});

const updatedMemberSchema = memberSchema.extend({
  teamsLeftWithoutAdmin: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .optional(),
});

const accessBindingSchema = z.object({
  id: z.string(),
  role: z.string(),
  customRoleName: z.string().nullable(),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string(),
  scopeName: z.string().nullable(),
  permissions: z.array(z.string()),
});

const accessBreakdownSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    orgRole: z.string(),
    orgRolePermissions: z.array(z.string()),
  }),
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      scimSource: z.string().nullable(),
      bindings: z.array(accessBindingSchema),
    }),
  ),
  directBindings: z.array(accessBindingSchema),
});

const inviteTeamSchema = z.object({
  teamId: z.string(),
  role: z.string(),
  customRoleId: z.string().nullable(),
});

const inviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.nativeEnum(OrganizationUserRole),
  status: z.string(),
  expiration: z.date().nullable(),
  inviteCode: z.string(),
  inviteUrl: z.string(),
  teams: z.array(inviteTeamSchema),
  createdAt: z.date(),
});

const createInvitesSchema = z.object({
  invites: z
    .array(
      z.object({
        email: z.string().trim().min(1).email(),
        role: z.nativeEnum(OrganizationUserRole),
        teams: z
          .array(
            z.object({
              teamId: z.string().min(1),
              role: z.nativeEnum(TeamUserRole),
              customRoleId: z.string().min(1).optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1)
    .max(50),
});

const createdInvitesSchema = z.object({
  invites: z.array(inviteSchema.extend({ emailNotSent: z.boolean() })),
});

const listMembersQuerySchema = z.object({
  includeDisabled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const userIdParamsSchema = z.object({ userId: z.string().min(1) });

const successSchema = z.object({ success: z.literal(true) });

// ── mapping helpers ──────────────────────────────────────────────────────────

const memberWire = (member: OrganizationMemberSummary) => ({
  userId: member.userId,
  role: member.role,
  disabled: member.disabledAt !== null,
  disabledAt: member.disabledAt,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
  user: member.user,
});

/**
 * The invite's team assignments in the one shape POST accepts, whichever of
 * the two storage forms the row carries (explicit assignments, or the legacy
 * comma-separated team ids that imply the organization role's default).
 */
const inviteTeams = (invite: OrganizationInvite) => {
  if (Array.isArray(invite.teamAssignments)) {
    return (
      invite.teamAssignments as unknown as Array<{
        teamId: string;
        role: string;
        customRoleId?: string | null;
      }>
    ).map((assignment) => ({
      teamId: assignment.teamId,
      role: assignment.role,
      customRoleId: assignment.customRoleId ?? null,
    }));
  }
  return invite.teamIds
    .split(",")
    .map((teamId) => teamId.trim())
    .filter(Boolean)
    .map((teamId) => ({
      teamId,
      role: ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role] as string,
      customRoleId: null,
    }));
};

const inviteWire = (
  invite: OrganizationInvite & { inviteUrl: string },
): z.infer<typeof inviteSchema> => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  status: invite.status,
  expiration: invite.expiration,
  inviteCode: invite.inviteCode,
  inviteUrl: invite.inviteUrl,
  teams: inviteTeams(invite),
  createdAt: invite.createdAt,
});

const organizationOf = (c: Context): Organization =>
  c.get("organization") as Organization;

/** The member the credential acts as; null for a service key. */
const actorUserIdOf = (c: Context): string | null =>
  (c.get("apiKeyUserId") as string | null) ?? null;

/**
 * The management surface's one wire code for "no seat left": the license
 * layer reports overflow as `resource_limit_exceeded`, which on this family
 * would make two member endpoints answer the same refusal under two names.
 */
const rethrowSeatLimit = (error: unknown): never => {
  if (error instanceof LimitExceededError) {
    throw new MemberSeatLimitReachedError({
      meta: {
        limitType: error.limitType,
        current: error.current,
        max: error.max,
      },
    });
  }
  throw error;
};

// ── handlers ─────────────────────────────────────────────────────────────────

const getOrganizationHandler = async (
  c: Context,
  { app }: { app: OrganizationFamilyApp },
) => app.organizations.getSettings(organizationOf(c).id);

const updateOrganizationHandler = async (
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

const listMembersHandler = async (
  c: Context,
  {
    query,
    app,
  }: {
    query: z.infer<typeof listMembersQuerySchema>;
    app: OrganizationFamilyApp;
  },
) => {
  const { members, totalCount } = await app.organizations.listMembers({
    organizationId: organizationOf(c).id,
    includeDisabled: query.includeDisabled ?? false,
    offset: query.offset ?? 0,
    limit: query.limit ?? 50,
  });
  return { members: members.map(memberWire), totalCount };
};

const getMemberHandler = async (
  c: Context,
  {
    params,
    app,
  }: {
    params: z.infer<typeof userIdParamsSchema>;
    app: OrganizationFamilyApp;
  },
) => {
  const member = await app.organizations.getMember({
    organizationId: organizationOf(c).id,
    userId: params.userId,
  });
  return { ...memberWire(member), teams: member.teams };
};

/** The role branch of the member PATCH; seat overflow renamed at the seam. */
const applyMemberRoleChange = async ({
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
const applyMemberDisabledChange = async ({
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

const updateMemberHandler = async (
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

const removeMemberHandler = async (
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

const memberAccessHandler = async (
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
  return app.roleBindings.getMyAccessBreakdown({
    organizationId: organization.id,
    userId: member.userId,
    userName: member.user.name,
    userEmail: member.user.email,
  });
};

const listInvitesHandler = async (
  c: Context,
  { app }: { app: OrganizationFamilyApp },
) => {
  const invites = await app.invites.listInvites({
    organizationId: organizationOf(c).id,
  });
  return { invites: invites.map(inviteWire) };
};

const createInvitesHandler = async (
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

const revokeInviteHandler = async (
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

// ── endpoint registration ────────────────────────────────────────────────────

const registerProfileEndpoints = (v: OrganizationVersion): void => {
  v.get(
    "/",
    {
      ...guard("organization:view"),
      output: organizationSettingsSchema,
      description:
        "Read the organization profile: name, slug, support contact, presence and trace sharing settings, and the S3 storage shape. The single sign-on fields and the S3 secret are never returned.",
      docs: { operationId: "getOrganization", tags: ["Organization"] },
    },
    getOrganizationHandler,
  );

  v.patch(
    "/",
    {
      ...guard("organization:manage"),
      input: updateOrganizationSchema,
      output: organizationSettingsSchema,
      description:
        "Update the organization profile. Partial: only the fields present are written, and the response is exactly what a subsequent GET returns.",
      docs: { operationId: "updateOrganization", tags: ["Organization"] },
    },
    updateOrganizationHandler,
  );
};

const registerMemberReadEndpoints = (v: OrganizationVersion): void => {
  v.get(
    "/members",
    {
      ...guard("organization:view"),
      query: listMembersQuerySchema,
      output: z.object({
        members: z.array(memberSchema),
        totalCount: z.number(),
      }),
      description:
        "List the organization's members with their organization role and disabled status. Disabled members are included only when includeDisabled=true.",
      docs: { operationId: "listOrganizationMembers", tags: ["Members"] },
    },
    listMembersHandler,
  );

  v.get(
    "/members/:userId",
    {
      ...guard("organization:view"),
      params: userIdParamsSchema,
      output: memberWithTeamsSchema,
      description:
        "Read one member, including the teams they reach through team-scoped role bindings. Personal workspaces are not listed: they are not access an administrator manages.",
      docs: { operationId: "getOrganizationMember", tags: ["Members"] },
    },
    getMemberHandler,
  );

  v.get(
    "/members/:userId/access",
    {
      ...guard("organization:manage"),
      params: userIdParamsSchema,
      output: accessBreakdownSchema,
      description:
        "The member's full access breakdown: organization role, group memberships with their bindings, and direct bindings, each with the permissions it grants and the scope it grants them on.",
      docs: { operationId: "getOrganizationMemberAccess", tags: ["Members"] },
    },
    memberAccessHandler,
  );
};

const registerMemberWriteEndpoints = (v: OrganizationVersion): void => {
  v.patch(
    "/members/:userId",
    {
      ...guard("organization:manage"),
      params: userIdParamsSchema,
      input: updateMemberSchema,
      output: updatedMemberSchema,
      description:
        "Change a member's organization role, or disable / re-enable their membership. Send exactly one of role or disabled. Re-enabling consumes a seat, so it is checked against the plan.",
      docs: { operationId: "updateOrganizationMember", tags: ["Members"] },
    },
    updateMemberHandler,
  );

  v.delete(
    "/members/:userId",
    {
      ...guard("organization:manage"),
      params: userIdParamsSchema,
      output: successSchema,
      description:
        "Remove a member from the organization and every team in it. The member the credential acts as cannot remove themselves.",
      docs: { operationId: "removeOrganizationMember", tags: ["Members"] },
    },
    removeMemberHandler,
  );
};

const registerInviteEndpoints = (v: OrganizationVersion): void => {
  v.get(
    "/invites",
    {
      ...guard("organization:manage"),
      output: z.object({ invites: z.array(inviteSchema) }),
      description:
        "List pending invites. Each carries its invite code and acceptance link, because a provisioning run with no email provider still has to hand the person something to open.",
      docs: { operationId: "listOrganizationInvites", tags: ["Invites"] },
    },
    listInvitesHandler,
  );

  v.post(
    "/invites",
    {
      ...guard("organization:manage"),
      input: createInvitesSchema,
      output: createdInvitesSchema,
      status: 201,
      description:
        "Create up to 50 invites in one batch, each with team assignments that may carry a custom role. Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than silently granting less than was asked. emailNotSent reports, per invite, whether the invite email could be delivered.",
      docs: { operationId: "createOrganizationInvites", tags: ["Invites"] },
    },
    createInvitesHandler,
  );

  v.delete(
    "/invites/:id",
    {
      ...guard("organization:manage"),
      params: z.object({ id: z.string().min(1) }),
      output: successSchema,
      description:
        "Revoke a pending invite. An invite id from another organization, or one already revoked, answers 404.",
      docs: { operationId: "revokeOrganizationInvite", tags: ["Invites"] },
    },
    revokeInviteHandler,
  );
};

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .provide({
    organizations: () =>
      new OrganizationService(
        new PrismaOrganizationRepository(prisma),
        new PromptTagRepository(prisma),
      ),
    invites: () => InviteService.create(prisma),
    roleBindings: () =>
      new RoleBindingService(
        prisma,
        new PrismaRoleBindingRepository(prisma),
        new RoleService(prisma),
      ),
  })
  .version(MANAGEMENT_API_VERSION, (v) => {
    registerProfileEndpoints(v);
    registerMemberReadEndpoints(v);
    registerMemberWriteEndpoints(v);
    registerInviteEndpoints(v);
  })
  .build();
