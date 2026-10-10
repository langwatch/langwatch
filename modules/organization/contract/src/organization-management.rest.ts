/**
 * The wire shapes the `/api/organization` REST family publishes: profile,
 * member and invite reads/writes for an external API caller — narrower than
 * `organization.trpc-schemas.ts`, which carries the browser's own transport.
 */
import { grantScopeTierSchema, teamUserRoleSchema } from "@langwatch/authz-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { organizationApiMemberRoleSchema } from "./organization.trpc-schemas.ts";
import { organizationIntentSchema, organizationSettingsSchema } from "./organization.ts";

/** What `GET /` and `PATCH /` answer: the canonical settings shape. */
export const organizationManagementRestSettingsSchema = organizationSettingsSchema;

const organizationManagementRestUpdateSchemaDefinition = z.object({
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
export interface OrganizationManagementRestUpdateSchema extends Named<
  typeof organizationManagementRestUpdateSchemaDefinition
> {}
export const organizationManagementRestUpdateSchema: OrganizationManagementRestUpdateSchema =
  organizationManagementRestUpdateSchemaDefinition;

const organizationManagementRestMemberSchemaDefinition = z.object({
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
export interface OrganizationManagementRestMemberSchema extends Named<
  typeof organizationManagementRestMemberSchemaDefinition
> {}
export const organizationManagementRestMemberSchema: OrganizationManagementRestMemberSchema =
  organizationManagementRestMemberSchemaDefinition;

const organizationManagementRestMemberTeamSchemaDefinition = z.object({
  teamId: z.string(),
  teamName: z.string(),
  role: teamUserRoleSchema,
  customRoleId: z.string().nullable(),
  customRoleName: z.string().nullable(),
});
export interface OrganizationManagementRestMemberTeamSchema extends Named<
  typeof organizationManagementRestMemberTeamSchemaDefinition
> {}
export const organizationManagementRestMemberTeamSchema: OrganizationManagementRestMemberTeamSchema =
  organizationManagementRestMemberTeamSchemaDefinition;

const organizationManagementRestUpdateMemberSchemaDefinition = z
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
export interface OrganizationManagementRestUpdateMemberSchema extends Named<
  typeof organizationManagementRestUpdateMemberSchemaDefinition
> {}
export const organizationManagementRestUpdateMemberSchema: OrganizationManagementRestUpdateMemberSchema =
  organizationManagementRestUpdateMemberSchemaDefinition;

const organizationManagementRestMemberWithTeamsSchemaDefinition = z.object({
  ...organizationManagementRestMemberSchema.shape,
  teams: z.array(organizationManagementRestMemberTeamSchema),
});
export interface OrganizationManagementRestMemberWithTeamsSchema extends Named<
  typeof organizationManagementRestMemberWithTeamsSchemaDefinition
> {}
export const organizationManagementRestMemberWithTeamsSchema: OrganizationManagementRestMemberWithTeamsSchema =
  organizationManagementRestMemberWithTeamsSchemaDefinition;

const organizationManagementRestUpdatedMemberSchemaDefinition = z.object({
  ...organizationManagementRestMemberSchema.shape,
  teamsLeftWithoutAdmin: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});
export interface OrganizationManagementRestUpdatedMemberSchema extends Named<
  typeof organizationManagementRestUpdatedMemberSchemaDefinition
> {}
export const organizationManagementRestUpdatedMemberSchema: OrganizationManagementRestUpdatedMemberSchema =
  organizationManagementRestUpdatedMemberSchemaDefinition;

/** What `GET /members` answers: the page of members plus how many there are in total. */
const organizationManagementRestMemberListSchemaDefinition = z.object({
  members: z.array(organizationManagementRestMemberSchema),
  totalCount: z.number(),
});
export interface OrganizationManagementRestMemberListSchema extends Named<
  typeof organizationManagementRestMemberListSchemaDefinition
> {}
export const organizationManagementRestMemberListSchema: OrganizationManagementRestMemberListSchema =
  organizationManagementRestMemberListSchemaDefinition;

const organizationManagementRestAccessBindingSchema = z.object({
  id: z.string(),
  role: z.string(),
  customRoleName: z.string().nullable(),
  scopeType: grantScopeTierSchema,
  scopeId: z.string(),
  scopeName: z.string().nullable(),
  permissions: z.array(z.string()),
  cappedBySeat: z.boolean(),
});

const organizationManagementRestAccessBreakdownSchemaDefinition = z.object({
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
export interface OrganizationManagementRestAccessBreakdownSchema extends Named<
  typeof organizationManagementRestAccessBreakdownSchemaDefinition
> {}
export const organizationManagementRestAccessBreakdownSchema: OrganizationManagementRestAccessBreakdownSchema =
  organizationManagementRestAccessBreakdownSchemaDefinition;

const organizationManagementRestInviteTeamSchema = z.object({
  teamId: z.string(),
  role: z.string(),
  customRoleId: z.string().nullable(),
});

const organizationManagementRestInviteSchemaDefinition = z.object({
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
export interface OrganizationManagementRestInviteSchema extends Named<
  typeof organizationManagementRestInviteSchemaDefinition
> {}
export const organizationManagementRestInviteSchema: OrganizationManagementRestInviteSchema =
  organizationManagementRestInviteSchemaDefinition;

const organizationManagementRestCreateInvitesSchemaDefinition = z.object({
  invites: z
    .array(
      z
        .object({
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
            .optional(),
        })
        // Every seat names a team except a Developer, who is invited onto none (ADR-171).
        .superRefine((invite, ctx) => {
          if (invite.role !== "DEVELOPER" && !invite.teams?.length) {
            ctx.addIssue({
              code: "too_small",
              origin: "array",
              minimum: 1,
              inclusive: true,
              path: ["teams"],
              message: "Too small: expected array to have >=1 items",
            });
          }
        }),
    )
    .min(1)
    .max(50),
});
export interface OrganizationManagementRestCreateInvitesSchema extends Named<
  typeof organizationManagementRestCreateInvitesSchemaDefinition
> {}
export const organizationManagementRestCreateInvitesSchema: OrganizationManagementRestCreateInvitesSchema =
  organizationManagementRestCreateInvitesSchemaDefinition;

const organizationManagementRestCreatedInvitesSchemaDefinition = z.object({
  invites: z.array(
    z.object({ ...organizationManagementRestInviteSchema.shape, emailNotSent: z.boolean() }),
  ),
});
export interface OrganizationManagementRestCreatedInvitesSchema extends Named<
  typeof organizationManagementRestCreatedInvitesSchemaDefinition
> {}
export const organizationManagementRestCreatedInvitesSchema: OrganizationManagementRestCreatedInvitesSchema =
  organizationManagementRestCreatedInvitesSchemaDefinition;

/** What `GET /invites` answers: the pending invites, each with its acceptance link. */
const organizationManagementRestInviteListSchemaDefinition = z.object({
  invites: z.array(organizationManagementRestInviteSchema),
});
export interface OrganizationManagementRestInviteListSchema extends Named<
  typeof organizationManagementRestInviteListSchemaDefinition
> {}
export const organizationManagementRestInviteListSchema: OrganizationManagementRestInviteListSchema =
  organizationManagementRestInviteListSchemaDefinition;

const organizationManagementRestListMembersQuerySchemaDefinition = z.object({
  includeDisabled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export interface OrganizationManagementRestListMembersQuerySchema extends Named<
  typeof organizationManagementRestListMembersQuerySchemaDefinition
> {}
export const organizationManagementRestListMembersQuerySchema: OrganizationManagementRestListMembersQuerySchema =
  organizationManagementRestListMembersQuerySchemaDefinition;

const organizationManagementRestUserIdParamsSchemaDefinition = z.object({
  userId: z.string().min(1),
});
export interface OrganizationManagementRestUserIdParamsSchema extends Named<
  typeof organizationManagementRestUserIdParamsSchemaDefinition
> {}
export const organizationManagementRestUserIdParamsSchema: OrganizationManagementRestUserIdParamsSchema =
  organizationManagementRestUserIdParamsSchemaDefinition;
const organizationManagementRestInviteIdParamsSchemaDefinition = z.object({
  inviteId: z.string().min(1),
});
export interface OrganizationManagementRestInviteIdParamsSchema extends Named<
  typeof organizationManagementRestInviteIdParamsSchemaDefinition
> {}
export const organizationManagementRestInviteIdParamsSchema: OrganizationManagementRestInviteIdParamsSchema =
  organizationManagementRestInviteIdParamsSchemaDefinition;

const organizationManagementRestSuccessSchemaDefinition = z.object({ success: z.literal(true) });
export interface OrganizationManagementRestSuccessSchema extends Named<
  typeof organizationManagementRestSuccessSchemaDefinition
> {}
export const organizationManagementRestSuccessSchema: OrganizationManagementRestSuccessSchema =
  organizationManagementRestSuccessSchemaDefinition;

/**
 * One stored team assignment on an invite row. `Array.isArray` proves nothing
 * about the list's members, so malformed entries are dropped rather than
 * failing the read - the invite is still worth reporting.
 */
const organizationManagementRestStoredTeamAssignmentSchemaDefinition = z.object({
  teamId: z.string().min(1),
  role: z.string().min(1),
  customRoleId: z.string().nullish(),
});
export interface OrganizationManagementRestStoredTeamAssignmentSchema extends Named<
  typeof organizationManagementRestStoredTeamAssignmentSchemaDefinition
> {}
export const organizationManagementRestStoredTeamAssignmentSchema: OrganizationManagementRestStoredTeamAssignmentSchema =
  organizationManagementRestStoredTeamAssignmentSchemaDefinition;
