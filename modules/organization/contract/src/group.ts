import { authzGrantCallerSchema } from "@langwatch/authz-contract";
import { z } from "zod";

import { organizationIdSchema } from "./organization.ts";
import { organizationLedgerActorSchema } from "./team.ts";

export const organizationGroupRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
export type OrganizationGroupRole = z.infer<typeof organizationGroupRoleSchema>;

export const organizationGroupScopeTypeSchema = z.enum(["ORGANIZATION", "TEAM", "PROJECT"]);
export type OrganizationGroupScopeType = z.infer<typeof organizationGroupScopeTypeSchema>;

export const organizationGroupGrantSchema = z
  .object({
    id: z.string().min(1),
    role: organizationGroupRoleSchema,
    customRoleId: z.string().nullable(),
    customRoleName: z.string().nullable(),
    scopeType: organizationGroupScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export type OrganizationGroupGrant = z.infer<typeof organizationGroupGrantSchema>;

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

export const organizationGroupDetailsSchema = organizationGroupSchema.safeExtend({
  members: z.array(organizationGroupMemberSchema),
  grants: z.array(organizationGroupGrantSchema),
});
export type OrganizationGroupDetails = z.infer<typeof organizationGroupDetailsSchema>;

export const organizationGroupSummarySchema = organizationGroupSchema.safeExtend({
  memberCount: z.number().int().nonnegative(),
  grants: z.array(organizationGroupGrantSchema),
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

export const organizationGroupGrantInputSchema = z
  .object({
    role: organizationGroupRoleSchema,
    customRoleId: z.string().min(1).optional(),
    scopeType: organizationGroupScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export type OrganizationGroupGrantInput = z.infer<typeof organizationGroupGrantInputSchema>;

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
export type ListOrganizationGroupsInput = z.infer<typeof listOrganizationGroupsInputSchema>;

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
    grants: z.array(organizationGroupGrantInputSchema).optional(),
    memberIds: z.array(z.string().min(1)).optional(),
    caller: authzGrantCallerSchema,
    actor: organizationLedgerActorSchema,
  })
  .strict();
export type CreateOrganizationGroupInput = z.infer<typeof createOrganizationGroupInputSchema>;

export const renameOrganizationGroupInputSchema = getOrganizationGroupInputSchema.safeExtend({
  name: z.string().trim().min(1).max(100),
});
export type RenameOrganizationGroupInput = z.infer<typeof renameOrganizationGroupInputSchema>;

export const deleteOrganizationGroupInputSchema = getOrganizationGroupInputSchema.safeExtend({
  actor: organizationLedgerActorSchema,
  allowScimManaged: z.boolean().optional(),
});
export type DeleteOrganizationGroupInput = z.infer<typeof deleteOrganizationGroupInputSchema>;

export const changeOrganizationGroupMemberInputSchema = getOrganizationGroupInputSchema.safeExtend({
  userId: z.string().min(1),
});
export type ChangeOrganizationGroupMemberInput = z.infer<
  typeof changeOrganizationGroupMemberInputSchema
>;

/** Joining a group confers its grants, so the caller's ceiling bounds who may be added. */
export const addOrganizationGroupMemberInputSchema =
  changeOrganizationGroupMemberInputSchema.safeExtend({ caller: authzGrantCallerSchema });
export type AddOrganizationGroupMemberInput = z.infer<typeof addOrganizationGroupMemberInputSchema>;

export const addOrganizationGroupGrantInputSchema = getOrganizationGroupInputSchema.safeExtend({
  grant: organizationGroupGrantInputSchema,
  caller: authzGrantCallerSchema,
  actor: organizationLedgerActorSchema,
});
export type AddOrganizationGroupGrantInput = z.infer<typeof addOrganizationGroupGrantInputSchema>;

export const removeOrganizationGroupGrantInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    groupId: z.string().min(1).optional(),
    grantId: z.string().min(1),
    actor: organizationLedgerActorSchema,
  })
  .strict();
export type RemoveOrganizationGroupGrantInput = z.infer<
  typeof removeOrganizationGroupGrantInputSchema
>;

export const applyOrganizationGroupEditsInputSchema = getOrganizationGroupInputSchema.safeExtend({
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
  actor: organizationLedgerActorSchema,
});
export type ApplyOrganizationGroupEditsInput = z.infer<
  typeof applyOrganizationGroupEditsInputSchema
>;
