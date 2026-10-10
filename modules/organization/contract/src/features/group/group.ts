import { ledgerActorSchema } from "@langwatch/authorization";
import { authzGrantCallerSchema } from "@langwatch/authz-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { organizationIdSchema } from "../../organization.ts";

export const organizationGroupRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
export type OrganizationGroupRole = z.infer<typeof organizationGroupRoleSchema>;

export const organizationGroupScopeTypeSchema = z.enum(["ORGANIZATION", "TEAM", "PROJECT"]);
export type OrganizationGroupScopeType = z.infer<typeof organizationGroupScopeTypeSchema>;

const organizationGroupGrantSchemaDefinition = z
  .object({
    id: z.string().min(1),
    role: organizationGroupRoleSchema,
    customRoleId: z.string().nullable(),
    customRoleName: z.string().nullable(),
    scopeType: organizationGroupScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export interface OrganizationGroupGrantSchema extends Named<
  typeof organizationGroupGrantSchemaDefinition
> {}
export const organizationGroupGrantSchema: OrganizationGroupGrantSchema =
  organizationGroupGrantSchemaDefinition;
export type OrganizationGroupGrant = z.infer<typeof organizationGroupGrantSchema>;

const organizationGroupMemberSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    image: z.string().nullable(),
  })
  .strict();
export interface OrganizationGroupMemberSchema extends Named<
  typeof organizationGroupMemberSchemaDefinition
> {}
export const organizationGroupMemberSchema: OrganizationGroupMemberSchema =
  organizationGroupMemberSchemaDefinition;
export type OrganizationGroupMember = z.infer<typeof organizationGroupMemberSchema>;

const organizationGroupSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: organizationIdSchema,
    name: z.string().min(1),
    slug: z.string().min(1),
    externalId: z.string().nullable(),
    scimSource: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface OrganizationGroupSchema extends Named<typeof organizationGroupSchemaDefinition> {}
export const organizationGroupSchema: OrganizationGroupSchema = organizationGroupSchemaDefinition;
export type OrganizationGroup = z.infer<typeof organizationGroupSchema>;

const organizationGroupDetailsSchemaDefinition = organizationGroupSchema.safeExtend({
  members: z.array(organizationGroupMemberSchema),
  grants: z.array(organizationGroupGrantSchema),
});
export interface OrganizationGroupDetailsSchema extends Named<
  typeof organizationGroupDetailsSchemaDefinition
> {}
export const organizationGroupDetailsSchema: OrganizationGroupDetailsSchema =
  organizationGroupDetailsSchemaDefinition;
export type OrganizationGroupDetails = z.infer<typeof organizationGroupDetailsSchema>;

const organizationGroupSummarySchemaDefinition = organizationGroupSchema.safeExtend({
  memberCount: z.number().int().nonnegative(),
  grants: z.array(organizationGroupGrantSchema),
});
export interface OrganizationGroupSummarySchema extends Named<
  typeof organizationGroupSummarySchemaDefinition
> {}
export const organizationGroupSummarySchema: OrganizationGroupSummarySchema =
  organizationGroupSummarySchemaDefinition;
export type OrganizationGroupSummary = z.infer<typeof organizationGroupSummarySchema>;

const organizationGroupPageSchemaDefinition = z
  .object({
    data: z.array(organizationGroupSummarySchema),
    pagination: z
      .object({
        page: z.number().int().positive(),
        limit: z.number().int().positive(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export interface OrganizationGroupPageSchema extends Named<
  typeof organizationGroupPageSchemaDefinition
> {}
export const organizationGroupPageSchema: OrganizationGroupPageSchema =
  organizationGroupPageSchemaDefinition;
export type OrganizationGroupPage = z.infer<typeof organizationGroupPageSchema>;

const organizationGroupGrantInputSchemaDefinition = z
  .object({
    role: organizationGroupRoleSchema,
    customRoleId: z.string().min(1).optional(),
    scopeType: organizationGroupScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export interface OrganizationGroupGrantInputSchema extends Named<
  typeof organizationGroupGrantInputSchemaDefinition
> {}
export const organizationGroupGrantInputSchema: OrganizationGroupGrantInputSchema =
  organizationGroupGrantInputSchemaDefinition;
export type OrganizationGroupGrantInput = z.infer<typeof organizationGroupGrantInputSchema>;

const getOrganizationGroupInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    groupId: z.string().min(1),
  })
  .strict();
export interface GetOrganizationGroupInputSchema extends Named<
  typeof getOrganizationGroupInputSchemaDefinition
> {}
export const getOrganizationGroupInputSchema: GetOrganizationGroupInputSchema =
  getOrganizationGroupInputSchemaDefinition;
export type GetOrganizationGroupInput = z.infer<typeof getOrganizationGroupInputSchema>;

const listOrganizationGroupsInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(1_000),
  })
  .strict();
export interface ListOrganizationGroupsInputSchema extends Named<
  typeof listOrganizationGroupsInputSchemaDefinition
> {}
export const listOrganizationGroupsInputSchema: ListOrganizationGroupsInputSchema =
  listOrganizationGroupsInputSchemaDefinition;
export type ListOrganizationGroupsInput = z.infer<typeof listOrganizationGroupsInputSchema>;

const listMemberOrganizationGroupsInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    userId: z.string().min(1),
  })
  .strict();
export interface ListMemberOrganizationGroupsInputSchema extends Named<
  typeof listMemberOrganizationGroupsInputSchemaDefinition
> {}
export const listMemberOrganizationGroupsInputSchema: ListMemberOrganizationGroupsInputSchema =
  listMemberOrganizationGroupsInputSchemaDefinition;
export type ListMemberOrganizationGroupsInput = z.infer<
  typeof listMemberOrganizationGroupsInputSchema
>;

const createOrganizationGroupInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    name: z.string().trim().min(1).max(100),
    grants: z.array(organizationGroupGrantInputSchema).optional(),
    memberIds: z.array(z.string().min(1)).optional(),
    caller: authzGrantCallerSchema,
    actor: ledgerActorSchema,
  })
  .strict();
export interface CreateOrganizationGroupInputSchema extends Named<
  typeof createOrganizationGroupInputSchemaDefinition
> {}
export const createOrganizationGroupInputSchema: CreateOrganizationGroupInputSchema =
  createOrganizationGroupInputSchemaDefinition;
export type CreateOrganizationGroupInput = z.infer<typeof createOrganizationGroupInputSchema>;

const renameOrganizationGroupInputSchemaDefinition = getOrganizationGroupInputSchema.safeExtend({
  name: z.string().trim().min(1).max(100),
});
export interface RenameOrganizationGroupInputSchema extends Named<
  typeof renameOrganizationGroupInputSchemaDefinition
> {}
export const renameOrganizationGroupInputSchema: RenameOrganizationGroupInputSchema =
  renameOrganizationGroupInputSchemaDefinition;
export type RenameOrganizationGroupInput = z.infer<typeof renameOrganizationGroupInputSchema>;

const deleteOrganizationGroupInputSchemaDefinition = getOrganizationGroupInputSchema.safeExtend({
  actor: ledgerActorSchema,
  allowScimManaged: z.boolean().optional(),
});
export interface DeleteOrganizationGroupInputSchema extends Named<
  typeof deleteOrganizationGroupInputSchemaDefinition
> {}
export const deleteOrganizationGroupInputSchema: DeleteOrganizationGroupInputSchema =
  deleteOrganizationGroupInputSchemaDefinition;
export type DeleteOrganizationGroupInput = z.infer<typeof deleteOrganizationGroupInputSchema>;

const changeOrganizationGroupMemberInputSchemaDefinition =
  getOrganizationGroupInputSchema.safeExtend({
    userId: z.string().min(1),
  });
export interface ChangeOrganizationGroupMemberInputSchema extends Named<
  typeof changeOrganizationGroupMemberInputSchemaDefinition
> {}
export const changeOrganizationGroupMemberInputSchema: ChangeOrganizationGroupMemberInputSchema =
  changeOrganizationGroupMemberInputSchemaDefinition;
export type ChangeOrganizationGroupMemberInput = z.infer<
  typeof changeOrganizationGroupMemberInputSchema
>;

/** Joining a group confers its grants, so the caller's ceiling bounds who may be added. */
const addOrganizationGroupMemberInputSchemaDefinition =
  changeOrganizationGroupMemberInputSchema.safeExtend({ caller: authzGrantCallerSchema });
export interface AddOrganizationGroupMemberInputSchema extends Named<
  typeof addOrganizationGroupMemberInputSchemaDefinition
> {}
export const addOrganizationGroupMemberInputSchema: AddOrganizationGroupMemberInputSchema =
  addOrganizationGroupMemberInputSchemaDefinition;
export type AddOrganizationGroupMemberInput = z.infer<typeof addOrganizationGroupMemberInputSchema>;

const addOrganizationGroupGrantInputSchemaDefinition = getOrganizationGroupInputSchema.safeExtend({
  grant: organizationGroupGrantInputSchema,
  caller: authzGrantCallerSchema,
  actor: ledgerActorSchema,
});
export interface AddOrganizationGroupGrantInputSchema extends Named<
  typeof addOrganizationGroupGrantInputSchemaDefinition
> {}
export const addOrganizationGroupGrantInputSchema: AddOrganizationGroupGrantInputSchema =
  addOrganizationGroupGrantInputSchemaDefinition;
export type AddOrganizationGroupGrantInput = z.infer<typeof addOrganizationGroupGrantInputSchema>;

const removeOrganizationGroupGrantInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    groupId: z.string().min(1).optional(),
    grantId: z.string().min(1),
    actor: ledgerActorSchema,
  })
  .strict();
export interface RemoveOrganizationGroupGrantInputSchema extends Named<
  typeof removeOrganizationGroupGrantInputSchemaDefinition
> {}
export const removeOrganizationGroupGrantInputSchema: RemoveOrganizationGroupGrantInputSchema =
  removeOrganizationGroupGrantInputSchemaDefinition;
export type RemoveOrganizationGroupGrantInput = z.infer<
  typeof removeOrganizationGroupGrantInputSchema
>;

const applyOrganizationGroupEditsInputSchemaDefinition = getOrganizationGroupInputSchema.safeExtend(
  {
    rename: z
      .object({ name: z.string().trim().min(1).max(100) })
      .strict()
      .nullable()
      .optional(),
    grantIdsToRevoke: z.array(z.string().min(1)),
    grantsToCreate: z.array(organizationGroupGrantInputSchema),
    memberUserIdsToAdd: z.array(z.string().min(1)),
    memberUserIdsToRemove: z.array(z.string().min(1)),
    caller: authzGrantCallerSchema,
    actor: ledgerActorSchema,
  },
);
export interface ApplyOrganizationGroupEditsInputSchema extends Named<
  typeof applyOrganizationGroupEditsInputSchemaDefinition
> {}
export const applyOrganizationGroupEditsInputSchema: ApplyOrganizationGroupEditsInputSchema =
  applyOrganizationGroupEditsInputSchemaDefinition;
export type ApplyOrganizationGroupEditsInput = z.infer<
  typeof applyOrganizationGroupEditsInputSchema
>;
