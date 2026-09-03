import { z } from "zod";
import { organizationIdSchema } from "./organization";
import { organizationLedgerActorSchema } from "./team";

export const organizationGroupRoleSchema = z.enum([
  "ADMIN",
  "MEMBER",
  "VIEWER",
  "CUSTOM",
]);
export type OrganizationGroupRole = z.infer<typeof organizationGroupRoleSchema>;

export const organizationGroupScopeTypeSchema = z.enum([
  "ORGANIZATION",
  "TEAM",
  "PROJECT",
]);
export type OrganizationGroupScopeType = z.infer<typeof organizationGroupScopeTypeSchema>;

export const organizationGroupBindingSchema = z
  .object({
    id: z.string().min(1),
    role: organizationGroupRoleSchema,
    customRoleId: z.string().nullable(),
    customRoleName: z.string().nullable(),
    scopeType: organizationGroupScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export type OrganizationGroupBinding = z.infer<typeof organizationGroupBindingSchema>;

export const organizationGroupMemberSchema = z
  .object({
    userId: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    image: z.string().nullable(),
  })
  .strict();
export type OrganizationGroupMember = z.infer<typeof organizationGroupMemberSchema>;

export const organizationGroupSchema = z
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
export type OrganizationGroup = z.infer<typeof organizationGroupSchema>;

export const organizationGroupDetailsSchema = organizationGroupSchema.extend({
  members: z.array(organizationGroupMemberSchema),
  bindings: z.array(organizationGroupBindingSchema),
});
export type OrganizationGroupDetails = z.infer<typeof organizationGroupDetailsSchema>;

export const organizationGroupSummarySchema = organizationGroupSchema.extend({
  memberCount: z.number().int().nonnegative(),
  bindings: z.array(organizationGroupBindingSchema),
});
export type OrganizationGroupSummary = z.infer<typeof organizationGroupSummarySchema>;

export const organizationGroupPageSchema = z
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
export type OrganizationGroupPage = z.infer<typeof organizationGroupPageSchema>;

export const organizationGroupBindingInputSchema = z
  .object({
    role: organizationGroupRoleSchema,
    customRoleId: z.string().min(1).optional(),
    scopeType: organizationGroupScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export type OrganizationGroupBindingInput = z.infer<
  typeof organizationGroupBindingInputSchema
>;

export const getOrganizationGroupInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    groupId: z.string().min(1),
  })
  .strict();
export type GetOrganizationGroupInput = z.infer<typeof getOrganizationGroupInputSchema>;

export const listOrganizationGroupsInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(1_000),
  })
  .strict();
export type ListOrganizationGroupsInput = z.infer<
  typeof listOrganizationGroupsInputSchema
>;

export const listMemberOrganizationGroupsInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    userId: z.string().min(1),
  })
  .strict();
export type ListMemberOrganizationGroupsInput = z.infer<
  typeof listMemberOrganizationGroupsInputSchema
>;

export const createOrganizationGroupInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    name: z.string().trim().min(1).max(100),
    bindings: z.array(organizationGroupBindingInputSchema).optional(),
    memberIds: z.array(z.string().min(1)).optional(),
    actor: organizationLedgerActorSchema,
  })
  .strict();
export type CreateOrganizationGroupInput = z.infer<
  typeof createOrganizationGroupInputSchema
>;

export const renameOrganizationGroupInputSchema = getOrganizationGroupInputSchema.extend({
  name: z.string().trim().min(1).max(100),
});
export type RenameOrganizationGroupInput = z.infer<
  typeof renameOrganizationGroupInputSchema
>;

export const deleteOrganizationGroupInputSchema = getOrganizationGroupInputSchema.extend({
  actor: organizationLedgerActorSchema,
  allowScimManaged: z.boolean().optional(),
});
export type DeleteOrganizationGroupInput = z.infer<
  typeof deleteOrganizationGroupInputSchema
>;

export const changeOrganizationGroupMemberInputSchema =
  getOrganizationGroupInputSchema.extend({
    userId: z.string().min(1),
  });
export type ChangeOrganizationGroupMemberInput = z.infer<
  typeof changeOrganizationGroupMemberInputSchema
>;

export const addOrganizationGroupBindingInputSchema =
  getOrganizationGroupInputSchema.extend({
    binding: organizationGroupBindingInputSchema,
    actor: organizationLedgerActorSchema,
  });
export type AddOrganizationGroupBindingInput = z.infer<
  typeof addOrganizationGroupBindingInputSchema
>;

export const removeOrganizationGroupBindingInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    groupId: z.string().min(1).optional(),
    bindingId: z.string().min(1),
    actor: organizationLedgerActorSchema,
  })
  .strict();
export type RemoveOrganizationGroupBindingInput = z.infer<
  typeof removeOrganizationGroupBindingInputSchema
>;

export const applyOrganizationGroupEditsInputSchema =
  getOrganizationGroupInputSchema.extend({
    rename: z
      .object({ name: z.string().trim().min(1).max(100) })
      .strict()
      .nullable()
      .optional(),
    bindingIdsToDelete: z.array(z.string().min(1)),
    bindingsToCreate: z.array(organizationGroupBindingInputSchema),
    memberUserIdsToAdd: z.array(z.string().min(1)),
    memberUserIdsToRemove: z.array(z.string().min(1)),
    actor: organizationLedgerActorSchema,
  });
export type ApplyOrganizationGroupEditsInput = z.infer<
  typeof applyOrganizationGroupEditsInputSchema
>;
