import { z } from "zod";
import { grantsLedgerActorSchema } from "./authz-grant.events";
import { organizationRoleSchema, roleBindingScopeTypeSchema, teamUserRoleSchema } from "./authz";

const nullableTextSchema = z.string().nullable();

export const authzBindingWriteSchema = z
  .object({
    role: teamUserRoleSchema,
    customRoleId: z.string().min(1).nullish(),
    scopeType: roleBindingScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export type AuthzBindingWrite = z.infer<typeof authzBindingWriteSchema>;

export const authzListManagedBindingsForUserInputSchema = z
  .object({ organizationId: z.string().min(1), userId: z.string().min(1) })
  .strict();
export type AuthzListManagedBindingsForUserInput = z.infer<
  typeof authzListManagedBindingsForUserInputSchema
>;

export const authzManagedUserBindingSchema = z
  .object({
    id: z.string(),
    userId: z.string().nullable(),
    role: teamUserRoleSchema,
    customRoleId: nullableTextSchema,
    customRoleName: nullableTextSchema,
    scopeType: roleBindingScopeTypeSchema,
    scopeId: z.string(),
    scopeName: nullableTextSchema,
    createdAt: z.date(),
  })
  .strict();
export type AuthzManagedUserBinding = z.infer<typeof authzManagedUserBindingSchema>;

export const authzListManagedBindingsForUserOutputSchema = z.array(authzManagedUserBindingSchema);
export type AuthzListManagedBindingsForUserOutput = z.infer<
  typeof authzListManagedBindingsForUserOutputSchema
>;

export const authzListManagedBindingsForOrganizationInputSchema = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export type AuthzListManagedBindingsForOrganizationInput = z.infer<
  typeof authzListManagedBindingsForOrganizationInputSchema
>;

export const authzManagedOrganizationBindingSchema = z
  .object({
    id: z.string(),
    userId: nullableTextSchema,
    userName: nullableTextSchema,
    userEmail: nullableTextSchema,
    userImage: nullableTextSchema,
    groupId: nullableTextSchema,
    groupName: nullableTextSchema,
    groupScimSource: nullableTextSchema,
    apiKeyId: nullableTextSchema,
    apiKeyName: nullableTextSchema,
    role: teamUserRoleSchema,
    customRoleId: nullableTextSchema,
    customRoleName: nullableTextSchema,
    scopeType: roleBindingScopeTypeSchema,
    scopeId: z.string(),
    scopeName: nullableTextSchema,
    memberUserIds: z.array(z.string()),
    createdAt: z.date(),
  })
  .strict();
export type AuthzManagedOrganizationBinding = z.infer<typeof authzManagedOrganizationBindingSchema>;

export const authzListManagedBindingsForOrganizationOutputSchema = z.array(
  authzManagedOrganizationBindingSchema,
);
export type AuthzListManagedBindingsForOrganizationOutput = z.infer<
  typeof authzListManagedBindingsForOrganizationOutputSchema
>;

export const authzAccessBreakdownInputSchema = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    userName: nullableTextSchema,
    userEmail: nullableTextSchema,
  })
  .strict();
export type AuthzAccessBreakdownInput = z.infer<typeof authzAccessBreakdownInputSchema>;

export const authzAccessBreakdownBindingSchema = z
  .object({
    id: z.string(),
    role: z.string(),
    customRoleName: nullableTextSchema,
    scopeType: roleBindingScopeTypeSchema,
    scopeId: z.string(),
    scopeName: nullableTextSchema,
    permissions: z.array(z.string()),
  })
  .strict();

export const authzAccessBreakdownOutputSchema = z
  .object({
    user: z
      .object({
        id: z.string(),
        name: nullableTextSchema,
        email: nullableTextSchema,
        orgRole: organizationRoleSchema,
        orgRolePermissions: z.array(z.string()),
      })
      .strict(),
    groups: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          scimSource: nullableTextSchema,
          bindings: z.array(authzAccessBreakdownBindingSchema),
        })
        .strict(),
    ),
    directBindings: z.array(authzAccessBreakdownBindingSchema),
  })
  .strict();
export type AuthzAccessBreakdownOutput = z.infer<typeof authzAccessBreakdownOutputSchema>;

export const authzLegacyAccessNoticeInputSchema = z
  .object({ organizationId: z.string().min(1), userId: z.string().min(1) })
  .strict();
export type AuthzLegacyAccessNoticeInput = z.infer<typeof authzLegacyAccessNoticeInputSchema>;

export const authzCreateBindingInputSchema = authzBindingWriteSchema.extend({
  organizationId: z.string().min(1),
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  apiKeyId: z.string().min(1).optional(),
  actor: grantsLedgerActorSchema,
});
export type AuthzCreateBindingInput = z.infer<typeof authzCreateBindingInputSchema>;

export const authzCreateBindingOutputSchema = z.object({ id: z.string().min(1) }).strict();
export type AuthzCreateBindingOutput = z.infer<typeof authzCreateBindingOutputSchema>;

export const authzUpdateBindingInputSchema = z
  .object({
    organizationId: z.string().min(1),
    bindingId: z.string().min(1),
    role: teamUserRoleSchema,
    customRoleId: z.string().min(1).optional(),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type AuthzUpdateBindingInput = z.infer<typeof authzUpdateBindingInputSchema>;

export const authzDeleteBindingInputSchema = z
  .object({
    organizationId: z.string().min(1),
    bindingId: z.string().min(1),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type AuthzDeleteBindingInput = z.infer<typeof authzDeleteBindingInputSchema>;

export const authzApplyMemberBindingsInputSchema = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    bindingIdsToDelete: z.array(z.string().min(1)),
    bindingsToCreate: z.array(authzBindingWriteSchema),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type AuthzApplyMemberBindingsInput = z.infer<typeof authzApplyMemberBindingsInputSchema>;

export const authzBindingMutationSuccessSchema = z.object({ success: z.literal(true) }).strict();
export type AuthzBindingMutationSuccess = z.infer<typeof authzBindingMutationSuccessSchema>;
