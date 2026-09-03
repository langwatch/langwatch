/**
 * The organization management REST family: the organization profile, its
 * members, and its invites, addressed with no {orgId} segment because the
 * organization is implied by the credential.
 *
 * Built on the versioned family the process's REST service hands out, so every
 * endpoint declares its RBAC permission once and gets the route-policy
 * registration, the org-key authentication (throwing mode), the permission
 * check (403) and the Enterprise plan gate (402) in that order. Every dated
 * version of a documented endpoint — plus `latest` — reaches the OpenAPI
 * document; there is no bare alias.
 *
 * Terraform-shaped: reads return every field a write accepts (the SSO fields
 * and the S3 secret are deliberately not owned by this API), PATCH is partial,
 * and deletes of missing resources answer their family's stable 404 code.
 *
 * ## Why the raw service and not {@link OrganizationApp}
 *
 * Every write here is attributed to `apiKeyUserId`, which is OPTIONAL: a
 * service credential acts as nobody, and both `deleteMember` and
 * `setMemberDisabled` document `null` as "skip the self-guard". The
 * application's member operations take a caller whose `id` is a `string`, so
 * routing this family through them would either invent an actor or refuse a
 * service key outright. The narrow service surface below is what the
 * credential can honestly reach; the application stays the browser's door.
 *
 * Everything this family touches that is NOT an organization read or write —
 * the invitation service, the licence seat guard, the trace-share revocation
 * that follows a settings change, the Enterprise plan gate and the audit sink —
 * is the process's, and arrives as a port.
 */
// The role and scope vocabularies come from the authz contract, which
// publishes them for the wire. They matched the generated Prisma enums
// member for member; taking them from storage meant the database decided
// what this door accepts.
import {
  roleBindingScopeTypeSchema,
  teamUserRoleSchema,
  type AuthzService,
  type TeamUserRole,
} from "@langwatch/authz-contract";
import type {
  OrganizationSettings,
  UpdateOrganizationSettingsInput,
  UpdateOrganizationSettingsResult,
} from "@langwatch/organization-contract";
import {
  organizationApiMemberRoleSchema,
  organizationIntentSchema,
  type OrganizationApiMemberRole,
} from "@langwatch/organization-contract";
import {
  type Organization,
  type OrganizationInvite,
  type OrganizationUser,
} from "@langwatch/prisma-client/generated";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  type AppRestManagementAuditPort,
  emitManagementAudit,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type AppRestSecurity,
  type ServiceContext,
} from "@langwatch/api/rest";

// ── what the process supplies ────────────────────────────────────────────────

/**
 * One membership row with the user it belongs to, as the members management
 * surface lists it. `disabledAt` is exposed rather than filtered so an admin
 * can see who is disabled in order to re-enable them.
 */
export interface OrganizationRestMemberSummary {
  userId: string;
  organizationId: string;
  role: OrganizationApiMemberRole;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string | null; email: string | null };
}

/**
 * One team the member reaches through a TEAM-scoped role binding. Personal
 * workspaces are excluded: they are not access an administrator granted or can
 * take away, so the management surfaces never list them.
 */
export interface OrganizationRestMemberTeamBinding {
  teamId: string;
  teamName: string;
  role: TeamUserRole;
  customRoleId: string | null;
  customRoleName: string | null;
}

/**
 * The seven organization reads and writes this family makes.
 *
 * Named structurally rather than picked off `OrganizationService`: only
 * `getSettings` and `updateSettings` are on the canonical contract, and the
 * five membership operations are the legacy organization surface the app
 * process still owns.
 */
export interface OrganizationRestService {
  getSettings(input: { organizationId: string }): Promise<OrganizationSettings>;
  updateSettings(input: UpdateOrganizationSettingsInput): Promise<UpdateOrganizationSettingsResult>;
  listMembers(input: {
    organizationId: string;
    includeDisabled?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<{ members: OrganizationRestMemberSummary[]; totalCount: number }>;
  getMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationRestMemberSummary & { teams: OrganizationRestMemberTeamBinding[] }>;
  changeMemberRole(input: {
    organizationId: string;
    userId: string;
    role: OrganizationApiMemberRole;
    /** Null when the actor is a service credential; self checks never match. */
    currentUserId: string | null;
    planUser?: { id: string };
  }): Promise<{ teamsLeftWithoutAdmin: { id: string; name: string }[] }>;
  setMemberDisabled(input: {
    organizationId: string;
    userId: string;
    disabled: boolean;
    /** The user the credential acts as; null (a service key) skips the self-guard. */
    actingUser?: { id: string } | null;
  }): Promise<void>;
  deleteMember(input: {
    organizationId: string;
    userId: string;
    actingUserId?: string | null;
  }): Promise<void>;
}

/** The three invitation operations this family makes. */
export interface OrganizationRestInviteService {
  /**
   * The pending and revoked invitations, each already carrying its acceptance
   * link — the listing is the one place the link is read back, and the service
   * that owns the invite row is what knows the deployment's base host.
   */
  listInvites(input: {
    organizationId: string;
  }): Promise<Array<OrganizationInvite & { inviteUrl: string }>>;
  createInvites(input: {
    organizationId: string;
    invites: {
      email: string;
      role: OrganizationApiMemberRole;
      teams: { teamId: string; role: TeamUserRole; customRoleId?: string }[];
    }[];
    user?: { id: string };
    validation: "strict" | "lenient";
  }): Promise<{
    organization: Organization & { members: OrganizationUser[] };
    invites: Array<{ invite: OrganizationInvite; emailNotSent: boolean }>;
  }>;
  revokeInvite(input: { organizationId: string; inviteId: string }): Promise<{ success: true }>;
}

/**
 * The capabilities this family dispatches through that belong to the process
 * rather than to the organization feature.
 */
export interface OrganizationRestPorts {
  /**
   * The management surface's one wire code for "no seat left".
   *
   * The licence layer reports overflow under its own error class and its own
   * code, so renaming it to this family's needs both, and neither is the
   * organization feature's to own. Throws; never returns.
   */
  rethrowSeatLimit(error: unknown): never;
  /**
   * The team role an invitation's organization role implies, for the legacy
   * storage form that carries comma-separated team ids and no roles at all.
   */
  defaultTeamRoleFor(role: OrganizationApiMemberRole): TeamUserRole | undefined;
  /**
   * The acceptance link an invite carries, so a provisioning run with no email
   * provider configured still has something to hand the person.
   */
  buildInviteAcceptUrl(inviteCode: string): string;
  /**
   * Turning trace sharing off revokes the links it minted. That is a fact
   * about shares and projects, not about organizations, so the effect the
   * settings write triggers is the process's to run.
   */
  onSettingsUpdated(
    context: Context,
    input: Readonly<{ organizationId: string; result: UpdateOrganizationSettingsResult }>,
  ): Promise<void>;
}

/**
 * The handler context every handler in this family receives: the framework's
 * variables plus the providers registered below, read as
 * `c.get("organizations")` and friends.
 */
type OrganizationContext = ServiceContext<
  EndpointVariables & {
    organizations: OrganizationRestService;
    invites: OrganizationRestInviteService;
    authz: AuthzService;
  }
>;

// ── wire schemas ─────────────────────────────────────────────────────────────

const organizationSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  supportContact: z.string().nullable(),
  presenceEnabled: z.boolean(),
  traceSharingEnabled: z.boolean(),
  primaryIntent: organizationIntentSchema.nullable(),
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
  primaryIntent: organizationIntentSchema.nullable().optional(),
  s3Endpoint: z.string().max(2048).nullable().optional(),
  s3AccessKeyId: z.string().max(1024).nullable().optional(),
  /** Write-only: accepted here, never read back. */
  s3SecretAccessKey: z.string().max(1024).nullable().optional(),
  s3Bucket: z.string().max(1024).nullable().optional(),
});

const memberSchema = z.object({
  userId: z.string(),
  role: organizationApiMemberRoleSchema,
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
  role: teamUserRoleSchema,
  customRoleId: z.string().nullable(),
  customRoleName: z.string().nullable(),
});

const updateMemberSchema = z
  .object({
    role: organizationApiMemberRoleSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const fields = [value.role, value.disabled].filter((field) => field !== undefined);
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
  teamsLeftWithoutAdmin: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});

const accessBindingSchema = z.object({
  id: z.string(),
  role: z.string(),
  customRoleName: z.string().nullable(),
  scopeType: roleBindingScopeTypeSchema,
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
  role: organizationApiMemberRoleSchema,
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
        role: organizationApiMemberRoleSchema,
        teams: z
          .array(
            z.object({
              teamId: z.string().min(1),
              role: teamUserRoleSchema,
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

const memberWire = (member: OrganizationRestMemberSummary) => ({
  userId: member.userId,
  role: member.role,
  disabled: member.disabledAt !== null,
  disabledAt: member.disabledAt,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
  user: member.user,
});

/**
 * One stored team assignment. `Array.isArray` proves the JSON column holds a list
 * and nothing about its members, so a legacy or hand-edited row would reach
 * the response schema with `teamId: undefined` and turn a read into a 500.
 * Malformed members are dropped rather than failing the read: the invite is
 * still worth reporting, and the row it came from cannot be fixed from here.
 */
const storedTeamAssignmentSchema = z.object({
  teamId: z.string().min(1),
  role: z.string().min(1),
  customRoleId: z.string().nullish(),
});

const organizationOf = (c: Context): Organization => c.get("organization") as Organization;

/** The member the credential acts as; null for a service key. */
const actorUserIdOf = (c: Context): string | null =>
  (c.get("apiKeyUserId") as string | null) ?? null;

/**
 * REST for one organization's profile, membership and invitations, built
 * against one process's security.
 */
export function createOrganizationRestApp(options: {
  security: AppRestSecurity;
  /**
   * The Enterprise plan gate for this family's capability, applied after
   * authentication and after the RBAC check on every route it declares.
   */
  enterpriseGate: MiddlewareHandler;
  /**
   * Resolved per request, as reading them off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  organizations: (context: Context) => OrganizationRestService;
  invites: (context: Context) => OrganizationRestInviteService;
  permissions: (context: Context) => AuthzService;
  audit: AppRestManagementAuditPort;
  ports: OrganizationRestPorts;
}): MountableRestApp {
  const { security, enterpriseGate, organizations, invites, permissions, audit, ports } = options;

  const { service, policy } = security.createVersionedApp({
    name: "organization",
    basePath: "/api/organization",
    routeMiddleware: [enterpriseGate],
  });

  /**
   * The invite's team assignments in the one shape POST accepts, whichever of
   * the two storage forms the row carries (explicit assignments, or the legacy
   * comma-separated team ids that imply the organization role's default).
   */
  const inviteTeams = (invite: OrganizationInvite) => {
    if (Array.isArray(invite.teamAssignments)) {
      return z
        .array(storedTeamAssignmentSchema.nullable().catch(null))
        .catch([])
        .parse(invite.teamAssignments)
        .filter((assignment) => assignment !== null)
        .map((assignment) => ({
          teamId: assignment.teamId,
          role: assignment.role,
          customRoleId: assignment.customRoleId ?? null,
        }));
    }
    const defaultTeamRole = ports.defaultTeamRoleFor(invite.role);
    if (!defaultTeamRole) return [];
    return invite.teamIds
      .split(",")
      .map((teamId) => teamId.trim())
      .filter(Boolean)
      .map((teamId) => ({
        teamId,
        role: defaultTeamRole,
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

  // ── handlers ───────────────────────────────────────────────────────────────

  const getOrganizationHandler = async (c: OrganizationContext) =>
    c.get("organizations").getSettings({ organizationId: organizationOf(c).id });

  const updateOrganizationHandler = async (
    c: OrganizationContext,
    input: z.infer<typeof updateOrganizationSchema>,
  ) => {
    const organization = organizationOf(c);
    const result = await c.get("organizations").updateSettings({
      organizationId: organization.id,
      ...input,
    });
    await ports.onSettingsUpdated(c, { organizationId: organization.id, result });
    emitManagementAudit({
      c,
      audit,
      organizationId: organization.id,
      action: "management.organization.update",
      args: { fields: Object.keys(input) },
    });
    return c.get("organizations").getSettings({ organizationId: organization.id });
  };

  const listMembersHandler = async (
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
      audit,
      organizationId,
      action: "management.organizationMember.list",
      args: { returned: members.length, totalCount },
    });
    return { members: members.map(memberWire), totalCount };
  };

  const getMemberHandler = async (
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
      audit,
      organizationId,
      action: "management.organizationMember.read",
      args: { userId: input.userId },
    });
    return { ...memberWire(member), teams: member.teams };
  };

  /** The role branch of the member PATCH; seat overflow renamed at the seam. */
  const applyMemberRoleChange = async ({
    service: organizationService,
    organizationId,
    userId,
    role,
    actorUserId,
  }: {
    service: OrganizationRestService;
    organizationId: string;
    userId: string;
    role: OrganizationApiMemberRole;
    actorUserId: string | null;
  }): Promise<Array<{ id: string; name: string }> | undefined> => {
    try {
      const result = await organizationService.changeMemberRole({
        organizationId,
        userId,
        role,
        currentUserId: actorUserId,
        ...(actorUserId ? { planUser: { id: actorUserId } } : {}),
      });
      return result.teamsLeftWithoutAdmin.length > 0 ? result.teamsLeftWithoutAdmin : undefined;
    } catch (error) {
      return ports.rethrowSeatLimit(error);
    }
  };

  /** The disabled branch of the member PATCH; same seat-limit seam. */
  const applyMemberDisabledChange = async ({
    service: organizationService,
    organizationId,
    userId,
    disabled,
    actorUserId,
  }: {
    service: OrganizationRestService;
    organizationId: string;
    userId: string;
    disabled: boolean;
    actorUserId: string | null;
  }): Promise<void> => {
    try {
      await organizationService.setMemberDisabled({
        organizationId,
        userId,
        disabled,
        actingUser: actorUserId ? { id: actorUserId } : null,
      });
    } catch (error) {
      ports.rethrowSeatLimit(error);
    }
  };

  const updateMemberHandler = async (
    c: OrganizationContext,
    input: z.infer<typeof userIdParamsSchema> & z.infer<typeof updateMemberSchema>,
  ) => {
    const organization = organizationOf(c);
    const actorUserId = actorUserIdOf(c);
    const organizationService = c.get("organizations");

    const teamsLeftWithoutAdmin =
      input.role !== undefined
        ? await applyMemberRoleChange({
            service: organizationService,
            organizationId: organization.id,
            userId: input.userId,
            role: input.role,
            actorUserId,
          })
        : await applyMemberDisabledChange({
            service: organizationService,
            organizationId: organization.id,
            userId: input.userId,
            disabled: input.disabled === true,
            actorUserId,
          }).then(() => undefined);

    emitManagementAudit({
      c,
      audit,
      organizationId: organization.id,
      action: "management.member.update",
      args: { ...input },
    });

    const member = await organizationService.getMember({
      organizationId: organization.id,
      userId: input.userId,
    });
    return {
      ...memberWire(member),
      ...(teamsLeftWithoutAdmin ? { teamsLeftWithoutAdmin } : {}),
    };
  };

  const removeMemberHandler = async (
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
      audit,
      organizationId: organization.id,
      action: "management.member.delete",
      args: { userId: input.userId },
    });
    return { success: true as const };
  };

  const memberAccessHandler = async (
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
      audit,
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

  const listInvitesHandler = async (c: OrganizationContext) => {
    const organizationId = organizationOf(c).id;
    const invitations = await c.get("invites").listInvites({
      organizationId,
    });
    // The invite wire carries the addresses plus the acceptance code and link,
    // so reading the list discloses more than the member directory read above
    // and leaves the same trace.
    emitManagementAudit({
      c,
      audit,
      organizationId,
      action: "management.invite.list",
      args: { returned: invitations.length },
    });
    return { invites: invitations.map(inviteWire) };
  };

  const createInvitesHandler = async (
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
        audit,
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
            inviteUrl: ports.buildInviteAcceptUrl(entry.invite.inviteCode),
          }),
          emailNotSent: entry.emailNotSent,
        })),
      };
    } catch (error) {
      return ports.rethrowSeatLimit(error);
    }
  };

  const revokeInviteHandler = async (c: OrganizationContext, input: { id: string }) => {
    const organization = organizationOf(c);
    await c.get("invites").revokeInvite({
      organizationId: organization.id,
      inviteId: input.id,
    });
    emitManagementAudit({
      c,
      audit,
      organizationId: organization.id,
      action: "management.invite.delete",
      args: { inviteId: input.id },
    });
    return { success: true as const };
  };

  // ── service wiring ─────────────────────────────────────────────────────────

  return (
    service
      .provide({
        organizations: (_base, context) => organizations(context),
        invites: (_base, context) => invites(context),
        authz: (_base, context) => permissions(context),
      })
      // ── profile ──────────────────────────────────────────────────────────────
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, getOrganizationHandler, (b) =>
        policy("organization:view")(b)
          .withOutput(organizationSettingsSchema)
          .withDocs({
            operationId: "getOrganization",
            tags: ["Organization"],
            description:
              "Read the organization profile: name, slug, support contact, presence and trace sharing settings, and the S3 storage shape. The single sign-on fields and the S3 secret are never returned.",
          }),
      )
      .registerRoute("patch", "/", MANAGEMENT_API_VERSION, updateOrganizationHandler, (b) =>
        policy("organization:manage")(b)
          .withInput(updateOrganizationSchema)
          .withOutput(organizationSettingsSchema)
          .withDocs({
            operationId: "updateOrganization",
            tags: ["Organization"],
            description:
              "Update the organization profile. Partial: only the fields present are written, and the response is exactly what a subsequent GET returns.",
          }),
      )
      // ── member reads ─────────────────────────────────────────────────────────
      .registerRoute("get", "/members", MANAGEMENT_API_VERSION, listMembersHandler, (b) =>
        policy("organization:view")(b)
          .withQuery(listMembersQuerySchema)
          .withOutput(
            z.object({
              members: z.array(memberSchema),
              totalCount: z.number(),
            }),
          )
          .withDocs({
            operationId: "listOrganizationMembers",
            tags: ["Members"],
            description:
              "List the organization's members with their organization role and disabled status. Disabled members are included only when includeDisabled=true.",
          }),
      )
      .registerRoute("get", "/members/:userId", MANAGEMENT_API_VERSION, getMemberHandler, (b) =>
        policy("organization:view")(b)
          .withParams(userIdParamsSchema)
          .withOutput(memberWithTeamsSchema)
          .withDocs({
            operationId: "getOrganizationMember",
            tags: ["Members"],
            description:
              "Read one member, including the teams they reach through team-scoped role bindings. Personal workspaces are not listed: they are not access an administrator manages.",
          }),
      )
      .registerRoute(
        "get",
        "/members/:userId/access",
        MANAGEMENT_API_VERSION,
        memberAccessHandler,
        (b) =>
          policy("organization:manage")(b)
            .withParams(userIdParamsSchema)
            .withOutput(accessBreakdownSchema)
            .withDocs({
              operationId: "getOrganizationMemberAccess",
              tags: ["Members"],
              description:
                "The member's full access breakdown: organization role, group memberships with their bindings, and direct bindings, each with the permissions it grants and the scope it grants them on.",
            }),
      )
      // ── member writes ────────────────────────────────────────────────────────
      .registerRoute(
        "patch",
        "/members/:userId",
        MANAGEMENT_API_VERSION,
        updateMemberHandler,
        (b) =>
          policy("organization:manage")(b)
            .withParams(userIdParamsSchema)
            .withInput(updateMemberSchema)
            .withOutput(updatedMemberSchema)
            .withDocs({
              operationId: "updateOrganizationMember",
              tags: ["Members"],
              description:
                "Change a member's organization role, or disable / re-enable their membership. Send exactly one of role or disabled. Re-enabling consumes a seat, so it is checked against the plan.",
            }),
      )
      .registerRoute(
        "delete",
        "/members/:userId",
        MANAGEMENT_API_VERSION,
        removeMemberHandler,
        (b) =>
          policy("organization:manage")(b)
            .withParams(userIdParamsSchema)
            .withOutput(successSchema)
            .withDocs({
              operationId: "removeOrganizationMember",
              tags: ["Members"],
              description:
                "Remove a member from the organization and every team in it. The member the credential acts as cannot remove themselves.",
            }),
      )
      // ── invites ──────────────────────────────────────────────────────────────
      .registerRoute("get", "/invites", MANAGEMENT_API_VERSION, listInvitesHandler, (b) =>
        policy("organization:manage")(b)
          .withOutput(z.object({ invites: z.array(inviteSchema) }))
          .withDocs({
            operationId: "listOrganizationInvites",
            tags: ["Invites"],
            description:
              "List pending invites. Each carries its invite code and acceptance link, because a provisioning run with no email provider still has to hand the person something to open.",
          }),
      )
      .registerRoute("post", "/invites", MANAGEMENT_API_VERSION, createInvitesHandler, (b) =>
        policy("organization:manage")(b)
          .withInput(createInvitesSchema)
          .withOutput(createdInvitesSchema)
          .withStatus(201)
          .withDocs({
            operationId: "createOrganizationInvites",
            tags: ["Invites"],
            description:
              "Create up to 50 invites in one batch, each with team assignments that may carry a custom role. Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than silently granting less than was asked. emailNotSent reports, per invite, whether the invite email could be delivered.",
          }),
      )
      .registerRoute("delete", "/invites/:id", MANAGEMENT_API_VERSION, revokeInviteHandler, (b) =>
        policy("organization:manage")(b)
          .withParams(z.object({ id: z.string().min(1) }))
          .withOutput(successSchema)
          .withDocs({
            operationId: "revokeOrganizationInvite",
            tags: ["Invites"],
            description:
              "Revoke a pending invite. An invite id from another organization, or one already revoked, answers 404.",
          }),
      )
      .build()
  );
}
