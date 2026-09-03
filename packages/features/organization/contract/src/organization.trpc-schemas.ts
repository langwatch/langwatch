import { z } from "zod";
import { organizationIntentSchema } from "./organization";

/**
 * The transport inputs the organization, membership and invitation surface
 * publishes.
 *
 * They live in the contract rather than beside the router because the input a
 * caller has to send is part of what this feature promises. The service-level
 * command shapes in `organization.ts` are a different contract: those describe
 * what `OrganizationService` accepts, these describe what a client sends.
 */

/** The organization a call is about, and the only scope most of them carry. */
export const organizationApiScopeSchema = z.object({ organizationId: z.string() });
export type OrganizationApiScope = z.infer<typeof organizationApiScopeSchema>;

/** One member of one organization. */
export const organizationApiMemberScopeSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
});
export type OrganizationApiMemberScope = z.infer<typeof organizationApiMemberScopeSchema>;

/**
 * The organization roles a member can hold, restated from the Postgres enum
 * `OrganizationUserRole`: a portable contract cannot depend on the generated
 * Prisma client, and the team roles beside it in `team.ts` are restated the
 * same way.
 */
export const organizationApiMemberRoleSchema = z.enum(["ADMIN", "MEMBER", "EXTERNAL"]);
export type OrganizationApiMemberRole = z.infer<typeof organizationApiMemberRoleSchema>;

export const organizationApiCustomTeamRoleSchema = z
  .string()
  .regex(/^custom:[a-zA-Z0-9_-]+$/, "Custom role must be in format 'custom:{roleId}'");

/**
 * The built-in team roles an invitation or a role change may name. `CUSTOM` is
 * deliberately absent: a custom role arrives as the `custom:<id>` form below.
 */
export const organizationApiBuiltInTeamRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

export const organizationApiTeamRoleSchema = z.union([
  organizationApiBuiltInTeamRoleSchema,
  organizationApiCustomTeamRoleSchema,
]);
export type OrganizationApiTeamRole = z.infer<typeof organizationApiTeamRoleSchema>;

export const organizationApiSetMemberDisabledInputSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  disabled: z.boolean(),
});
export type OrganizationApiSetMemberDisabledInput = z.infer<
  typeof organizationApiSetMemberDisabledInputSchema
>;

export const organizationApiGetAllInputSchema = z.object({ isDemo: z.boolean().optional() });
export type OrganizationApiGetAllInput = z.infer<typeof organizationApiGetAllInputSchema>;

export const organizationApiUpdateInputSchema = z
  .object({
    organizationId: z.string(),
    name: z.string(),
    s3Endpoint: z.string().optional(),
    s3AccessKeyId: z.string().optional(),
    s3SecretAccessKey: z.string().optional(),
    s3Bucket: z.string().optional(),
    presenceEnabled: z.boolean().optional(),
    traceSharingEnabled: z.boolean().optional(),
    supportContact: z.string().max(500).nullable().optional(),
    primaryIntent: organizationIntentSchema.nullable().optional(),
  })
  .refine(
    (data) => {
      const hasEndpoint = !!data.s3Endpoint?.trim();
      const hasAccessKey = !!data.s3AccessKeyId?.trim();
      const hasSecretKey = !!data.s3SecretAccessKey?.trim();

      return (
        (hasEndpoint && hasAccessKey && hasSecretKey) ||
        (!hasEndpoint && !hasAccessKey && !hasSecretKey)
      );
    },
    {
      message: "S3 Endpoint, Access Key ID, and Secret Access Key must all be provided together",
    },
  );
export type OrganizationApiUpdateInput = z.infer<typeof organizationApiUpdateInputSchema>;

export const organizationApiWithMembersInputSchema = z.object({
  organizationId: z.string(),
  includeDeactivated: z.boolean().optional(),
});
export type OrganizationApiWithMembersInput = z.infer<typeof organizationApiWithMembersInputSchema>;

export const organizationApiCreateInvitesInputSchema = z.object({
  organizationId: z.string(),
  invites: z.array(
    z.object({
      email: z.string().email(),
      teamIds: z.string().optional(), // Keep for backward compatibility
      teams: z
        .array(
          z.object({
            teamId: z.string(),
            role: organizationApiTeamRoleSchema,
            customRoleId: z.string().optional(),
          }),
        )
        .optional(),
      role: organizationApiMemberRoleSchema,
    }),
  ),
});
export type OrganizationApiCreateInvitesInput = z.infer<
  typeof organizationApiCreateInvitesInputSchema
>;

export const organizationApiInviteScopeSchema = z.object({
  inviteId: z.string(),
  organizationId: z.string(),
});
export type OrganizationApiInviteScope = z.infer<typeof organizationApiInviteScopeSchema>;

export const organizationApiAcceptInviteInputSchema = z.object({ inviteCode: z.string() });
export type OrganizationApiAcceptInviteInput = z.infer<
  typeof organizationApiAcceptInviteInputSchema
>;

export const organizationApiUpdateMemberRoleInputSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  role: organizationApiMemberRoleSchema,
  teamRoleUpdates: z
    .array(
      z.object({
        teamId: z.string(),
        userId: z.string(),
        role: organizationApiTeamRoleSchema,
        customRoleId: z.string().optional(),
      }),
    )
    .optional(),
});
export type OrganizationApiUpdateMemberRoleInput = z.infer<
  typeof organizationApiUpdateMemberRoleInputSchema
>;

/**
 * The fields of one team-role change. The refinement that pairs `role` with
 * `customRoleId` is applied by the transport, because what counts as a custom
 * role is the process's answer rather than the contract's.
 */
export const organizationApiUpdateTeamMemberRoleInputSchema = z.object({
  teamId: z.string(),
  userId: z.string(),
  role: organizationApiTeamRoleSchema,
  customRoleId: z.string().optional(),
});
export type OrganizationApiUpdateTeamMemberRoleInput = z.infer<
  typeof organizationApiUpdateTeamMemberRoleInputSchema
>;

export const organizationApiAuditLogsInputSchema = z.object({
  organizationId: z.string(),
  projectId: z.string().optional(),
  userId: z.string().optional(),
  pageOffset: z.number().min(0).default(0),
  pageSize: z.number().min(1).max(10000).default(25),
  action: z.string().optional(),
  startDate: z.number().optional(),
  endDate: z.number().optional(),
  // Gateway deep-link filters — forwarded to the UNION query so a
  // VK/budget detail page can link operators straight to the
  // pre-filtered history of that resource.
  targetKind: z.string().optional(),
  targetId: z.string().optional(),
});
export type OrganizationApiAuditLogsInput = z.infer<typeof organizationApiAuditLogsInputSchema>;
