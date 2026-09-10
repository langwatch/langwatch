/**
 * The wire shapes the `/api/organization` REST family publishes: the
 * management surface's profile, member and invite reads and writes. Narrower
 * than `organization.trpc-schemas.ts` on purpose - this is what an external
 * API caller sends and reads, not what the browser's own transport carries.
 */
import { z } from "zod";

import { organizationIntentSchema, organizationSettingsSchema } from "./organization.ts";
import { organizationApiMemberRoleSchema } from "./organization.trpc-schemas.ts";

/**
 * Restated rather than imported from `@langwatch/authz-contract`: this
 * package does not depend on it (see `organizationGroupScopeTypeSchema` in
 * `group.ts` for the same restatement).
 */
const teamUserRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
const roleBindingScopeTypeSchema = z.enum(["PROJECT", "TEAM", "ORGANIZATION"]);

/** What `GET /` and `PATCH /` answer: the canonical settings shape. */
export const organizationManagementRestSettingsSchema = organizationSettingsSchema;

export const organizationManagementRestUpdateSchema = z.object({
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

export const organizationManagementRestMemberSchema = z.object({
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

export const organizationManagementRestMemberTeamSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  role: teamUserRoleSchema,
  customRoleId: z.string().nullable(),
  customRoleName: z.string().nullable(),
});

export const organizationManagementRestUpdateMemberSchema = z
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

export const organizationManagementRestMemberWithTeamsSchema =
  organizationManagementRestMemberSchema.extend({
    teams: z.array(organizationManagementRestMemberTeamSchema),
  });

export const organizationManagementRestUpdatedMemberSchema =
  organizationManagementRestMemberSchema.extend({
    teamsLeftWithoutAdmin: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  });

const organizationManagementRestAccessBindingSchema = z.object({
  id: z.string(),
  role: z.string(),
  customRoleName: z.string().nullable(),
  scopeType: roleBindingScopeTypeSchema,
  scopeId: z.string(),
  scopeName: z.string().nullable(),
  permissions: z.array(z.string()),
});

export const organizationManagementRestAccessBreakdownSchema = z.object({
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
      bindings: z.array(organizationManagementRestAccessBindingSchema),
    }),
  ),
  directBindings: z.array(organizationManagementRestAccessBindingSchema),
});

const organizationManagementRestInviteTeamSchema = z.object({
  teamId: z.string(),
  role: z.string(),
  customRoleId: z.string().nullable(),
});

export const organizationManagementRestInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: organizationApiMemberRoleSchema,
  status: z.string(),
  expiration: z.date().nullable(),
  inviteCode: z.string(),
  inviteUrl: z.string(),
  teams: z.array(organizationManagementRestInviteTeamSchema),
  createdAt: z.date(),
});

export const organizationManagementRestCreateInvitesSchema = z.object({
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

export const organizationManagementRestCreatedInvitesSchema = z.object({
  invites: z.array(organizationManagementRestInviteSchema.extend({ emailNotSent: z.boolean() })),
});

export const organizationManagementRestListMembersQuerySchema = z.object({
  includeDisabled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const organizationManagementRestUserIdParamsSchema = z.object({ userId: z.string().min(1) });
export const organizationManagementRestInviteIdParamsSchema = z.object({ id: z.string().min(1) });

export const organizationManagementRestSuccessSchema = z.object({ success: z.literal(true) });

/**
 * One stored team assignment on an invite row. `Array.isArray` proves nothing
 * about the list's members, so malformed entries are dropped rather than
 * failing the read - the invite is still worth reporting.
 */
export const organizationManagementRestStoredTeamAssignmentSchema = z.object({
  teamId: z.string().min(1),
  role: z.string().min(1),
  customRoleId: z.string().nullish(),
});
