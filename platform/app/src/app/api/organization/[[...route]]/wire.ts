/**
 * The organization family's wire vocabulary: the zod schemas the endpoints
 * publish, the mappers from storage rows to those schemas, the two context
 * readers every handler starts from, and the one error rename the family
 * applies at the service seam.
 *
 * Separate from the handlers so the shapes a caller sees can be read without
 * the orchestration, and from `app.ts` so registration stays a list of
 * endpoints.
 */
import type { BaseApp } from "@langwatch/api";
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
import { MemberSeatLimitReachedError } from "~/server/app-layer/organizations/errors";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import type { OrganizationMemberSummary } from "~/server/app-layer/organizations/repositories/organization.repository";
import type { InviteService } from "~/server/invites/invite.service";
import { ORGANIZATION_TO_TEAM_ROLE_MAP } from "~/server/invites/invite.service";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import type { RoleBindingService } from "~/server/role-bindings/role-binding.service";

/** The provider context every handler in this family receives. */
export type OrganizationFamilyApp = BaseApp & {
  organizations: OrganizationService;
  invites: InviteService;
  roleBindings: RoleBindingService;
};

// ── wire schemas ─────────────────────────────────────────────────────────────

export const organizationSettingsSchema = z.object({
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

export const updateOrganizationSchema = z.object({
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

export const memberSchema = z.object({
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

export const memberTeamSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().nullable(),
  customRoleName: z.string().nullable(),
});

export const updateMemberSchema = z
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

export const memberWithTeamsSchema = memberSchema.extend({
  teams: z.array(memberTeamSchema),
});

export const updatedMemberSchema = memberSchema.extend({
  teamsLeftWithoutAdmin: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .optional(),
});

export const accessBindingSchema = z.object({
  id: z.string(),
  role: z.string(),
  customRoleName: z.string().nullable(),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string(),
  scopeName: z.string().nullable(),
  permissions: z.array(z.string()),
});

export const accessBreakdownSchema = z.object({
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

export const inviteTeamSchema = z.object({
  teamId: z.string(),
  role: z.string(),
  customRoleId: z.string().nullable(),
});

export const inviteSchema = z.object({
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

export const createInvitesSchema = z.object({
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

export const createdInvitesSchema = z.object({
  invites: z.array(inviteSchema.extend({ emailNotSent: z.boolean() })),
});

export const listMembersQuerySchema = z.object({
  includeDisabled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const userIdParamsSchema = z.object({ userId: z.string().min(1) });

export const successSchema = z.object({ success: z.literal(true) });

// ── mapping helpers ──────────────────────────────────────────────────────────

export const memberWire = (member: OrganizationMemberSummary) => ({
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
export const storedTeamAssignmentSchema = z.object({
  teamId: z.string().min(1),
  role: z.string().min(1),
  customRoleId: z.string().nullish(),
});

/**
 * The invite's team assignments in the one shape POST accepts, whichever of
 * the two storage forms the row carries (explicit assignments, or the legacy
 * comma-separated team ids that imply the organization role's default).
 */
export const inviteTeams = (invite: OrganizationInvite) => {
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
  const defaultTeamRole = ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role];
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

export const inviteWire = (
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

export const organizationOf = (c: Context): Organization =>
  c.get("organization") as Organization;

/** The member the credential acts as; null for a service key. */
export const actorUserIdOf = (c: Context): string | null =>
  (c.get("apiKeyUserId") as string | null) ?? null;

/**
 * The management surface's one wire code for "no seat left": the license
 * layer reports overflow as `resource_limit_exceeded`, which on this family
 * would make two member endpoints answer the same refusal under two names.
 */
export const rethrowSeatLimit = (error: unknown): never => {
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
