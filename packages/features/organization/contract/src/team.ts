import { z } from "zod";
import { organizationIdSchema } from "./organization";

export const organizationTeamRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);
export type OrganizationTeamRole = z.infer<typeof organizationTeamRoleSchema>;

export const organizationLedgerActorSchema = z
  .object({
    type: z.enum(["user", "system"]),
    id: z.string().nullable(),
  })
  .strict();
export type OrganizationLedgerActor = z.infer<typeof organizationLedgerActorSchema>;

export const organizationTeamSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    organizationId: organizationIdSchema,
    isPersonal: z.boolean(),
    ownerUserId: z.string().nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type OrganizationTeam = z.infer<typeof organizationTeamSchema>;

export const getOrganizationTeamInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    teamId: z.string().min(1),
  })
  .strict();
export type GetOrganizationTeamInput = z.infer<typeof getOrganizationTeamInputSchema>;

export const listOrganizationTeamsInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(1_000),
  })
  .strict();
export type ListOrganizationTeamsInput = z.infer<typeof listOrganizationTeamsInputSchema>;

export const organizationTeamPageSchema = z
  .object({
    data: z.array(organizationTeamSchema),
    pagination: z
      .object({
        page: z.number().int().positive(),
        limit: z.number().int().positive(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type OrganizationTeamPage = z.infer<typeof organizationTeamPageSchema>;

export const createOrganizationTeamInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    name: z.string().min(1).max(255),
  })
  .strict();
export type CreateOrganizationTeamInput = z.infer<typeof createOrganizationTeamInputSchema>;

export const updateOrganizationTeamInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    teamId: z.string().min(1),
    name: z.string().min(1).max(255).optional(),
  })
  .strict();
export type UpdateOrganizationTeamInput = z.infer<typeof updateOrganizationTeamInputSchema>;

export const changeOrganizationTeamMemberInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    teamId: z.string().min(1),
    userId: z.string().min(1),
    actor: organizationLedgerActorSchema,
  })
  .strict();

export const addOrganizationTeamMemberInputSchema = changeOrganizationTeamMemberInputSchema.extend({
  role: organizationTeamRoleSchema,
});
export type AddOrganizationTeamMemberInput = z.infer<typeof addOrganizationTeamMemberInputSchema>;

export type RemoveOrganizationTeamMemberInput = z.infer<
  typeof changeOrganizationTeamMemberInputSchema
>;

export const organizationTeamMemberRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
export type OrganizationTeamMemberRole = z.infer<typeof organizationTeamMemberRoleSchema>;

export const organizationTeamMemberInputSchema = z
  .object({
    userId: z.string().min(1),
    role: z.union([organizationTeamRoleSchema, z.string().regex(/^custom:[a-zA-Z0-9_-]+$/)]),
    customRoleId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((member, context) => {
    const custom = member.role.startsWith("custom:");
    if (custom && !member.customRoleId) {
      context.addIssue({
        code: "custom",
        path: ["customRoleId"],
        message: "customRoleId is required for a custom team role",
      });
    }
    if (!custom && member.customRoleId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["customRoleId"],
        message: "customRoleId is only valid for a custom team role",
      });
    }
  });
export type OrganizationTeamMemberInput = z.infer<typeof organizationTeamMemberInputSchema>;

export const organizationTeamMemberUserSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    image: z.string().nullable(),
  })
  .strict();
export type OrganizationTeamMemberUser = z.infer<typeof organizationTeamMemberUserSchema>;

export const organizationTeamAssignedRoleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    permissions: z.unknown(),
    organizationId: organizationIdSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .passthrough();
export type OrganizationTeamAssignedRole = z.infer<typeof organizationTeamAssignedRoleSchema>;

export const organizationTeamMemberSchema = z
  .object({
    userId: z.string().min(1),
    teamId: z.string().min(1),
    role: organizationTeamMemberRoleSchema,
    assignedRoleId: z.string().nullable(),
    assignedRole: organizationTeamAssignedRoleSchema.nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    user: organizationTeamMemberUserSchema,
  })
  .strict();
export type OrganizationTeamMember = z.infer<typeof organizationTeamMemberSchema>;

export const organizationTeamWithMembersSchema = organizationTeamSchema.extend({
  members: z.array(organizationTeamMemberSchema),
});
export type OrganizationTeamWithMembers = z.infer<typeof organizationTeamWithMembersSchema>;

export const getOrganizationTeamByIdInputSchema = z.object({ teamId: z.string().min(1) }).strict();
export type GetOrganizationTeamByIdInput = z.infer<typeof getOrganizationTeamByIdInputSchema>;

export const getOrganizationTeamBySlugInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    slug: z.string().min(1),
  })
  .strict();
export type GetOrganizationTeamBySlugInput = z.infer<typeof getOrganizationTeamBySlugInputSchema>;

export const getOrganizationTeamBySlugForMemberInputSchema =
  getOrganizationTeamBySlugInputSchema.extend({ userId: z.string().min(1) });
export type GetOrganizationTeamBySlugForMemberInput = z.infer<
  typeof getOrganizationTeamBySlugForMemberInputSchema
>;

export const getOrganizationTeamWithMembersInputSchema =
  getOrganizationTeamBySlugInputSchema.extend({
    callerUserId: z.string().min(1),
    callerCanManage: z.boolean(),
  });
export type GetOrganizationTeamWithMembersInput = z.infer<
  typeof getOrganizationTeamWithMembersInputSchema
>;

export const listOrganizationTeamsWithMembersInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    callerUserId: z.string().min(1),
    callerCanManage: z.boolean(),
  })
  .strict();
export type ListOrganizationTeamsWithMembersInput = z.infer<
  typeof listOrganizationTeamsWithMembersInputSchema
>;

export const createOrganizationTeamWithMembersInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    name: z.string().trim().min(1).max(255),
    members: z.array(organizationTeamMemberInputSchema),
    actor: organizationLedgerActorSchema,
  })
  .strict();
export type CreateOrganizationTeamWithMembersInput = z.infer<
  typeof createOrganizationTeamWithMembersInputSchema
>;

export const updateOrganizationTeamWithMembersInputSchema = z
  .object({
    teamId: z.string().min(1),
    name: z.string().trim().min(1).max(255),
    members: z.array(organizationTeamMemberInputSchema),
    actor: organizationLedgerActorSchema,
  })
  .strict();
export type UpdateOrganizationTeamWithMembersInput = z.infer<
  typeof updateOrganizationTeamWithMembersInputSchema
>;

export const organizationTeamAccessProjectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    teamId: z.string().min(1),
  })
  .strict();
export type OrganizationTeamAccessProject = z.infer<typeof organizationTeamAccessProjectSchema>;

export const listOrganizationTeamAccessInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    projects: z.array(organizationTeamAccessProjectSchema),
  })
  .strict();
export type ListOrganizationTeamAccessInput = z.infer<typeof listOrganizationTeamAccessInputSchema>;

export const organizationTeamAccessMemberSchema = z
  .object({
    bindingId: z.string().nullable(),
    userId: z.string().nullable(),
    groupId: z.string().nullable(),
    viaGroupId: z.string().nullable(),
    viaGroupName: z.string().nullable(),
    name: z.string(),
    email: z.string().nullable(),
    image: z.string().nullable(),
    role: organizationTeamMemberRoleSchema,
    customRoleId: z.string().nullable(),
    customRoleName: z.string().nullable(),
  })
  .strict();
export type OrganizationTeamAccessMember = z.infer<typeof organizationTeamAccessMemberSchema>;

export const organizationProjectOnlyAccessSchema = z
  .object({
    bindingId: z.string().min(1),
    userId: z.string().min(1),
    name: z.string(),
    email: z.string().nullable(),
    image: z.string().nullable(),
    role: organizationTeamMemberRoleSchema,
    customRoleId: z.string().nullable(),
    customRoleName: z.string().nullable(),
    projectId: z.string().min(1),
    projectName: z.string(),
  })
  .strict();
export type OrganizationProjectOnlyAccess = z.infer<typeof organizationProjectOnlyAccessSchema>;

export const organizationProjectAccessMemberSchema = organizationTeamAccessMemberSchema
  .omit({ viaGroupId: true })
  .extend({
    source: z.enum(["team", "direct", "override"]),
    teamRole: organizationTeamMemberRoleSchema.optional(),
  });
export type OrganizationProjectAccessMember = z.infer<typeof organizationProjectAccessMemberSchema>;

export const organizationTeamAccessSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string().min(1),
    projects: z.array(organizationTeamAccessProjectSchema),
    directMembers: z.array(organizationTeamAccessMemberSchema),
    projectOnlyAccess: z.array(organizationProjectOnlyAccessSchema),
    projectAccess: z.record(z.string(), z.array(organizationProjectAccessMemberSchema)),
  })
  .strict();
export type OrganizationTeamAccess = z.infer<typeof organizationTeamAccessSchema>;
