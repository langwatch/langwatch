import { ledgerActorSchema } from "@langwatch/authorization";
import { authzGrantCallerSchema } from "@langwatch/authz-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { organizationIdSchema } from "../../organization.ts";

export const organizationTeamRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);
export type OrganizationTeamRole = z.infer<typeof organizationTeamRoleSchema>;

const organizationTeamSchemaDefinition = z
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
export interface OrganizationTeamSchema extends Named<typeof organizationTeamSchemaDefinition> {}
export const organizationTeamSchema: OrganizationTeamSchema = organizationTeamSchemaDefinition;
export type OrganizationTeam = z.infer<typeof organizationTeamSchema>;

const getOrganizationTeamInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    teamId: z.string().min(1),
  })
  .strict();
export interface GetOrganizationTeamInputSchema extends Named<
  typeof getOrganizationTeamInputSchemaDefinition
> {}
export const getOrganizationTeamInputSchema: GetOrganizationTeamInputSchema =
  getOrganizationTeamInputSchemaDefinition;
export type GetOrganizationTeamInput = z.infer<typeof getOrganizationTeamInputSchema>;

const listOrganizationTeamsInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(1_000),
  })
  .strict();
export interface ListOrganizationTeamsInputSchema extends Named<
  typeof listOrganizationTeamsInputSchemaDefinition
> {}
export const listOrganizationTeamsInputSchema: ListOrganizationTeamsInputSchema =
  listOrganizationTeamsInputSchemaDefinition;
export type ListOrganizationTeamsInput = z.infer<typeof listOrganizationTeamsInputSchema>;

const organizationTeamPageSchemaDefinition = z
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
export interface OrganizationTeamPageSchema extends Named<
  typeof organizationTeamPageSchemaDefinition
> {}
export const organizationTeamPageSchema: OrganizationTeamPageSchema =
  organizationTeamPageSchemaDefinition;
export type OrganizationTeamPage = z.infer<typeof organizationTeamPageSchema>;

const createOrganizationTeamInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    name: z.string().min(1).max(255),
  })
  .strict();
export interface CreateOrganizationTeamInputSchema extends Named<
  typeof createOrganizationTeamInputSchemaDefinition
> {}
export const createOrganizationTeamInputSchema: CreateOrganizationTeamInputSchema =
  createOrganizationTeamInputSchemaDefinition;
export type CreateOrganizationTeamInput = z.infer<typeof createOrganizationTeamInputSchema>;

const updateOrganizationTeamInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    teamId: z.string().min(1),
    name: z.string().min(1).max(255).optional(),
  })
  .strict();
export interface UpdateOrganizationTeamInputSchema extends Named<
  typeof updateOrganizationTeamInputSchemaDefinition
> {}
export const updateOrganizationTeamInputSchema: UpdateOrganizationTeamInputSchema =
  updateOrganizationTeamInputSchemaDefinition;
export type UpdateOrganizationTeamInput = z.infer<typeof updateOrganizationTeamInputSchema>;

const changeOrganizationTeamMemberInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    teamId: z.string().min(1),
    userId: z.string().min(1),
    actor: ledgerActorSchema,
  })
  .strict();
export interface ChangeOrganizationTeamMemberInputSchema extends Named<
  typeof changeOrganizationTeamMemberInputSchemaDefinition
> {}
export const changeOrganizationTeamMemberInputSchema: ChangeOrganizationTeamMemberInputSchema =
  changeOrganizationTeamMemberInputSchemaDefinition;

const addOrganizationTeamMemberInputSchemaDefinition =
  changeOrganizationTeamMemberInputSchema.safeExtend({
    role: organizationTeamRoleSchema,
    caller: authzGrantCallerSchema,
  });
export interface AddOrganizationTeamMemberInputSchema extends Named<
  typeof addOrganizationTeamMemberInputSchemaDefinition
> {}
export const addOrganizationTeamMemberInputSchema: AddOrganizationTeamMemberInputSchema =
  addOrganizationTeamMemberInputSchemaDefinition;
export type AddOrganizationTeamMemberInput = z.infer<typeof addOrganizationTeamMemberInputSchema>;

export type RemoveOrganizationTeamMemberInput = z.infer<
  typeof changeOrganizationTeamMemberInputSchema
>;

export const organizationTeamMemberRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
export type OrganizationTeamMemberRole = z.infer<typeof organizationTeamMemberRoleSchema>;

const organizationTeamMemberInputSchemaDefinition = z
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
export interface OrganizationTeamMemberInputSchema extends Named<
  typeof organizationTeamMemberInputSchemaDefinition
> {}
export const organizationTeamMemberInputSchema: OrganizationTeamMemberInputSchema =
  organizationTeamMemberInputSchemaDefinition;
export type OrganizationTeamMemberInput = z.infer<typeof organizationTeamMemberInputSchema>;

const organizationTeamMemberUserSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    image: z.string().nullable(),
  })
  .strict();
export interface OrganizationTeamMemberUserSchema extends Named<
  typeof organizationTeamMemberUserSchemaDefinition
> {}
export const organizationTeamMemberUserSchema: OrganizationTeamMemberUserSchema =
  organizationTeamMemberUserSchemaDefinition;
export type OrganizationTeamMemberUser = z.infer<typeof organizationTeamMemberUserSchema>;

const organizationTeamAssignedRoleSchemaDefinition = z
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
export interface OrganizationTeamAssignedRoleSchema extends Named<
  typeof organizationTeamAssignedRoleSchemaDefinition
> {}
export const organizationTeamAssignedRoleSchema: OrganizationTeamAssignedRoleSchema =
  organizationTeamAssignedRoleSchemaDefinition;
export type OrganizationTeamAssignedRole = z.infer<typeof organizationTeamAssignedRoleSchema>;

const organizationTeamMemberSchemaDefinition = z
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
export interface OrganizationTeamMemberSchema extends Named<
  typeof organizationTeamMemberSchemaDefinition
> {}
export const organizationTeamMemberSchema: OrganizationTeamMemberSchema =
  organizationTeamMemberSchemaDefinition;
export type OrganizationTeamMember = z.infer<typeof organizationTeamMemberSchema>;

const organizationTeamWithMembersSchemaDefinition = organizationTeamSchema.safeExtend({
  members: z.array(organizationTeamMemberSchema),
});
export interface OrganizationTeamWithMembersSchema extends Named<
  typeof organizationTeamWithMembersSchemaDefinition
> {}
export const organizationTeamWithMembersSchema: OrganizationTeamWithMembersSchema =
  organizationTeamWithMembersSchemaDefinition;
export type OrganizationTeamWithMembers = z.infer<typeof organizationTeamWithMembersSchema>;

const getOrganizationTeamByIdInputSchemaDefinition = z
  .object({ teamId: z.string().min(1) })
  .strict();
export interface GetOrganizationTeamByIdInputSchema extends Named<
  typeof getOrganizationTeamByIdInputSchemaDefinition
> {}
export const getOrganizationTeamByIdInputSchema: GetOrganizationTeamByIdInputSchema =
  getOrganizationTeamByIdInputSchemaDefinition;
export type GetOrganizationTeamByIdInput = z.infer<typeof getOrganizationTeamByIdInputSchema>;

const getOrganizationTeamBySlugInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    slug: z.string().min(1),
  })
  .strict();
export interface GetOrganizationTeamBySlugInputSchema extends Named<
  typeof getOrganizationTeamBySlugInputSchemaDefinition
> {}
export const getOrganizationTeamBySlugInputSchema: GetOrganizationTeamBySlugInputSchema =
  getOrganizationTeamBySlugInputSchemaDefinition;
export type GetOrganizationTeamBySlugInput = z.infer<typeof getOrganizationTeamBySlugInputSchema>;

const getOrganizationTeamBySlugForMemberInputSchemaDefinition =
  getOrganizationTeamBySlugInputSchema.safeExtend({ userId: z.string().min(1) });
export interface GetOrganizationTeamBySlugForMemberInputSchema extends Named<
  typeof getOrganizationTeamBySlugForMemberInputSchemaDefinition
> {}
export const getOrganizationTeamBySlugForMemberInputSchema: GetOrganizationTeamBySlugForMemberInputSchema =
  getOrganizationTeamBySlugForMemberInputSchemaDefinition;
export type GetOrganizationTeamBySlugForMemberInput = z.infer<
  typeof getOrganizationTeamBySlugForMemberInputSchema
>;

const getOrganizationTeamWithMembersInputSchemaDefinition =
  getOrganizationTeamBySlugInputSchema.safeExtend({
    callerUserId: z.string().min(1),
    callerCanManage: z.boolean(),
  });
export interface GetOrganizationTeamWithMembersInputSchema extends Named<
  typeof getOrganizationTeamWithMembersInputSchemaDefinition
> {}
export const getOrganizationTeamWithMembersInputSchema: GetOrganizationTeamWithMembersInputSchema =
  getOrganizationTeamWithMembersInputSchemaDefinition;
export type GetOrganizationTeamWithMembersInput = z.infer<
  typeof getOrganizationTeamWithMembersInputSchema
>;

const listOrganizationTeamsWithMembersInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    callerUserId: z.string().min(1),
    callerCanManage: z.boolean(),
  })
  .strict();
export interface ListOrganizationTeamsWithMembersInputSchema extends Named<
  typeof listOrganizationTeamsWithMembersInputSchemaDefinition
> {}
export const listOrganizationTeamsWithMembersInputSchema: ListOrganizationTeamsWithMembersInputSchema =
  listOrganizationTeamsWithMembersInputSchemaDefinition;
export type ListOrganizationTeamsWithMembersInput = z.infer<
  typeof listOrganizationTeamsWithMembersInputSchema
>;

const createOrganizationTeamWithMembersInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    name: z.string().trim().min(1).max(255),
    members: z.array(organizationTeamMemberInputSchema),
    caller: authzGrantCallerSchema,
    actor: ledgerActorSchema,
  })
  .strict();
export interface CreateOrganizationTeamWithMembersInputSchema extends Named<
  typeof createOrganizationTeamWithMembersInputSchemaDefinition
> {}
export const createOrganizationTeamWithMembersInputSchema: CreateOrganizationTeamWithMembersInputSchema =
  createOrganizationTeamWithMembersInputSchemaDefinition;
export type CreateOrganizationTeamWithMembersInput = z.infer<
  typeof createOrganizationTeamWithMembersInputSchema
>;

const updateOrganizationTeamWithMembersInputSchemaDefinition = z
  .object({
    teamId: z.string().min(1),
    name: z.string().trim().min(1).max(255),
    members: z.array(organizationTeamMemberInputSchema),
    caller: authzGrantCallerSchema,
    actor: ledgerActorSchema,
  })
  .strict();
export interface UpdateOrganizationTeamWithMembersInputSchema extends Named<
  typeof updateOrganizationTeamWithMembersInputSchemaDefinition
> {}
export const updateOrganizationTeamWithMembersInputSchema: UpdateOrganizationTeamWithMembersInputSchema =
  updateOrganizationTeamWithMembersInputSchemaDefinition;
export type UpdateOrganizationTeamWithMembersInput = z.infer<
  typeof updateOrganizationTeamWithMembersInputSchema
>;

const organizationTeamAccessProjectSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    teamId: z.string().min(1),
  })
  .strict();
export interface OrganizationTeamAccessProjectSchema extends Named<
  typeof organizationTeamAccessProjectSchemaDefinition
> {}
export const organizationTeamAccessProjectSchema: OrganizationTeamAccessProjectSchema =
  organizationTeamAccessProjectSchemaDefinition;
export type OrganizationTeamAccessProject = z.infer<typeof organizationTeamAccessProjectSchema>;

const listOrganizationTeamAccessInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    projects: z.array(organizationTeamAccessProjectSchema),
  })
  .strict();
export interface ListOrganizationTeamAccessInputSchema extends Named<
  typeof listOrganizationTeamAccessInputSchemaDefinition
> {}
export const listOrganizationTeamAccessInputSchema: ListOrganizationTeamAccessInputSchema =
  listOrganizationTeamAccessInputSchemaDefinition;
export type ListOrganizationTeamAccessInput = z.infer<typeof listOrganizationTeamAccessInputSchema>;

const organizationTeamAccessMemberSchemaDefinition = z
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
export interface OrganizationTeamAccessMemberSchema extends Named<
  typeof organizationTeamAccessMemberSchemaDefinition
> {}
export const organizationTeamAccessMemberSchema: OrganizationTeamAccessMemberSchema =
  organizationTeamAccessMemberSchemaDefinition;
export type OrganizationTeamAccessMember = z.infer<typeof organizationTeamAccessMemberSchema>;

const organizationProjectOnlyAccessSchemaDefinition = z
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
export interface OrganizationProjectOnlyAccessSchema extends Named<
  typeof organizationProjectOnlyAccessSchemaDefinition
> {}
export const organizationProjectOnlyAccessSchema: OrganizationProjectOnlyAccessSchema =
  organizationProjectOnlyAccessSchemaDefinition;
export type OrganizationProjectOnlyAccess = z.infer<typeof organizationProjectOnlyAccessSchema>;

const organizationProjectAccessMemberSchemaDefinition = organizationTeamAccessMemberSchema
  .omit({ viaGroupId: true })
  .safeExtend({
    source: z.enum(["team", "direct", "override"]),
    teamRole: organizationTeamMemberRoleSchema.optional(),
  });
export interface OrganizationProjectAccessMemberSchema extends Named<
  typeof organizationProjectAccessMemberSchemaDefinition
> {}
export const organizationProjectAccessMemberSchema: OrganizationProjectAccessMemberSchema =
  organizationProjectAccessMemberSchemaDefinition;
export type OrganizationProjectAccessMember = z.infer<typeof organizationProjectAccessMemberSchema>;

const organizationTeamAccessSchemaDefinition = z
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
export interface OrganizationTeamAccessSchema extends Named<
  typeof organizationTeamAccessSchemaDefinition
> {}
export const organizationTeamAccessSchema: OrganizationTeamAccessSchema =
  organizationTeamAccessSchemaDefinition;
export type OrganizationTeamAccess = z.infer<typeof organizationTeamAccessSchema>;
