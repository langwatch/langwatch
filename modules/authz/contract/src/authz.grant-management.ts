import { ledgerActorSchema, organizationRoleSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { authzPrincipalRefSchema, grantScopeTierSchema, teamUserRoleSchema } from "./authz.ts";

/** Whose permissions bound what a write may grant (the key or person asking). */
const callerSchema = authzPrincipalRefSchema;

const nullableTextSchema = z.string().nullable();

const authzBindingWriteSchemaDefinition = z
  .object({
    role: teamUserRoleSchema,
    customRoleId: z.string().min(1).nullish(),
    scopeType: grantScopeTierSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export interface AuthzBindingWriteSchema extends Named<typeof authzBindingWriteSchemaDefinition> {}
export const authzBindingWriteSchema: AuthzBindingWriteSchema = authzBindingWriteSchemaDefinition;
export type AuthzBindingWrite = z.infer<typeof authzBindingWriteSchema>;

const authzListManagedBindingsForUserInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1), userId: z.string().min(1) })
  .strict();
export interface AuthzListManagedBindingsForUserInputSchema extends Named<
  typeof authzListManagedBindingsForUserInputSchemaDefinition
> {}
export const authzListManagedBindingsForUserInputSchema: AuthzListManagedBindingsForUserInputSchema =
  authzListManagedBindingsForUserInputSchemaDefinition;
export type AuthzListManagedBindingsForUserInput = z.infer<
  typeof authzListManagedBindingsForUserInputSchema
>;

const authzManagedUserBindingSchemaDefinition = z
  .object({
    id: z.string(),
    userId: z.string().nullable(),
    role: teamUserRoleSchema,
    customRoleId: nullableTextSchema,
    customRoleName: nullableTextSchema,
    scopeType: grantScopeTierSchema,
    scopeId: z.string(),
    scopeName: nullableTextSchema,
    createdAt: z.date(),
  })
  .strict();
export interface AuthzManagedUserBindingSchema extends Named<
  typeof authzManagedUserBindingSchemaDefinition
> {}
export const authzManagedUserBindingSchema: AuthzManagedUserBindingSchema =
  authzManagedUserBindingSchemaDefinition;
export type AuthzManagedUserBinding = z.infer<typeof authzManagedUserBindingSchema>;

const authzListManagedBindingsForUserOutputSchemaDefinition = z.array(
  authzManagedUserBindingSchema,
);
export interface AuthzListManagedBindingsForUserOutputSchema extends Named<
  typeof authzListManagedBindingsForUserOutputSchemaDefinition
> {}
export const authzListManagedBindingsForUserOutputSchema: AuthzListManagedBindingsForUserOutputSchema =
  authzListManagedBindingsForUserOutputSchemaDefinition;
export type AuthzListManagedBindingsForUserOutput = z.infer<
  typeof authzListManagedBindingsForUserOutputSchema
>;

const authzListManagedBindingsForOrganizationInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export interface AuthzListManagedBindingsForOrganizationInputSchema extends Named<
  typeof authzListManagedBindingsForOrganizationInputSchemaDefinition
> {}
export const authzListManagedBindingsForOrganizationInputSchema: AuthzListManagedBindingsForOrganizationInputSchema =
  authzListManagedBindingsForOrganizationInputSchemaDefinition;
export type AuthzListManagedBindingsForOrganizationInput = z.infer<
  typeof authzListManagedBindingsForOrganizationInputSchema
>;

const authzManagedOrganizationBindingSchemaDefinition = z
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
    scopeType: grantScopeTierSchema,
    scopeId: z.string(),
    scopeName: nullableTextSchema,
    memberUserIds: z.array(z.string()),
    createdAt: z.date(),
    /** When the binding stops granting; listed past its own date too. */
    expiresAt: z.date().nullable().optional(),
  })
  .strict();
export interface AuthzManagedOrganizationBindingSchema extends Named<
  typeof authzManagedOrganizationBindingSchemaDefinition
> {}
export const authzManagedOrganizationBindingSchema: AuthzManagedOrganizationBindingSchema =
  authzManagedOrganizationBindingSchemaDefinition;
export type AuthzManagedOrganizationBinding = z.infer<typeof authzManagedOrganizationBindingSchema>;

const authzListManagedBindingsForOrganizationOutputSchemaDefinition = z.array(
  authzManagedOrganizationBindingSchema,
);
export interface AuthzListManagedBindingsForOrganizationOutputSchema extends Named<
  typeof authzListManagedBindingsForOrganizationOutputSchemaDefinition
> {}
export const authzListManagedBindingsForOrganizationOutputSchema: AuthzListManagedBindingsForOrganizationOutputSchema =
  authzListManagedBindingsForOrganizationOutputSchemaDefinition;
export type AuthzListManagedBindingsForOrganizationOutput = z.infer<
  typeof authzListManagedBindingsForOrganizationOutputSchema
>;

const authzAccessBreakdownInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    userName: nullableTextSchema,
    userEmail: nullableTextSchema,
  })
  .strict();
export interface AuthzAccessBreakdownInputSchema extends Named<
  typeof authzAccessBreakdownInputSchemaDefinition
> {}
export const authzAccessBreakdownInputSchema: AuthzAccessBreakdownInputSchema =
  authzAccessBreakdownInputSchemaDefinition;
export type AuthzAccessBreakdownInput = z.infer<typeof authzAccessBreakdownInputSchema>;

const authzAccessBreakdownBindingSchemaDefinition = z
  .object({
    id: z.string(),
    role: z.string(),
    customRoleName: nullableTextSchema,
    scopeType: grantScopeTierSchema,
    scopeId: z.string(),
    scopeName: nullableTextSchema,
    permissions: z.array(z.string()),
    /** The member's seat holds this grant below the permissions it lists (a Lite seat). */
    cappedBySeat: z.boolean(),
  })
  .strict();
export interface AuthzAccessBreakdownBindingSchema extends Named<
  typeof authzAccessBreakdownBindingSchemaDefinition
> {}
export const authzAccessBreakdownBindingSchema: AuthzAccessBreakdownBindingSchema =
  authzAccessBreakdownBindingSchemaDefinition;

const authzAccessBreakdownOutputSchemaDefinition = z
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
export interface AuthzAccessBreakdownOutputSchema extends Named<
  typeof authzAccessBreakdownOutputSchemaDefinition
> {}
export const authzAccessBreakdownOutputSchema: AuthzAccessBreakdownOutputSchema =
  authzAccessBreakdownOutputSchemaDefinition;
export type AuthzAccessBreakdownOutput = z.infer<typeof authzAccessBreakdownOutputSchema>;

const authzLegacyAccessNoticeInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1), userId: z.string().min(1) })
  .strict();
export interface AuthzLegacyAccessNoticeInputSchema extends Named<
  typeof authzLegacyAccessNoticeInputSchemaDefinition
> {}
export const authzLegacyAccessNoticeInputSchema: AuthzLegacyAccessNoticeInputSchema =
  authzLegacyAccessNoticeInputSchemaDefinition;
export type AuthzLegacyAccessNoticeInput = z.infer<typeof authzLegacyAccessNoticeInputSchema>;

const authzCreateBindingInputSchemaDefinition = authzBindingWriteSchema.safeExtend({
  organizationId: z.string().min(1),
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  apiKeyId: z.string().min(1).optional(),
  actor: ledgerActorSchema,
  caller: callerSchema,
  /** When the binding stops granting; a moment already passed is refused. */
  expiresAt: z.date().optional(),
});
export interface AuthzCreateBindingInputSchema extends Named<
  typeof authzCreateBindingInputSchemaDefinition
> {}
export const authzCreateBindingInputSchema: AuthzCreateBindingInputSchema =
  authzCreateBindingInputSchemaDefinition;
export type AuthzCreateBindingInput = z.infer<typeof authzCreateBindingInputSchema>;

const authzCreateBindingOutputSchemaDefinition = z.object({ id: z.string().min(1) }).strict();
export interface AuthzCreateBindingOutputSchema extends Named<
  typeof authzCreateBindingOutputSchemaDefinition
> {}
export const authzCreateBindingOutputSchema: AuthzCreateBindingOutputSchema =
  authzCreateBindingOutputSchemaDefinition;
export type AuthzCreateBindingOutput = z.infer<typeof authzCreateBindingOutputSchema>;

const authzUpdateBindingInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    bindingId: z.string().min(1),
    role: teamUserRoleSchema,
    customRoleId: z.string().min(1).optional(),
    actor: ledgerActorSchema,
    caller: callerSchema,
  })
  .strict();
export interface AuthzUpdateBindingInputSchema extends Named<
  typeof authzUpdateBindingInputSchemaDefinition
> {}
export const authzUpdateBindingInputSchema: AuthzUpdateBindingInputSchema =
  authzUpdateBindingInputSchemaDefinition;
export type AuthzUpdateBindingInput = z.infer<typeof authzUpdateBindingInputSchema>;

const authzDeleteBindingInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    bindingId: z.string().min(1),
    actor: ledgerActorSchema,
    caller: callerSchema,
  })
  .strict();
export interface AuthzDeleteBindingInputSchema extends Named<
  typeof authzDeleteBindingInputSchemaDefinition
> {}
export const authzDeleteBindingInputSchema: AuthzDeleteBindingInputSchema =
  authzDeleteBindingInputSchemaDefinition;
export type AuthzDeleteBindingInput = z.infer<typeof authzDeleteBindingInputSchema>;

const authzApplyMemberBindingsInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    bindingIdsToDelete: z.array(z.string().min(1)),
    bindingsToCreate: z.array(authzBindingWriteSchema),
    actor: ledgerActorSchema,
    caller: callerSchema,
  })
  .strict();
export interface AuthzApplyMemberBindingsInputSchema extends Named<
  typeof authzApplyMemberBindingsInputSchemaDefinition
> {}
export const authzApplyMemberBindingsInputSchema: AuthzApplyMemberBindingsInputSchema =
  authzApplyMemberBindingsInputSchemaDefinition;
export type AuthzApplyMemberBindingsInput = z.infer<typeof authzApplyMemberBindingsInputSchema>;

const authzBindingMutationSuccessSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface AuthzBindingMutationSuccessSchema extends Named<
  typeof authzBindingMutationSuccessSchemaDefinition
> {}
export const authzBindingMutationSuccessSchema: AuthzBindingMutationSuccessSchema =
  authzBindingMutationSuccessSchemaDefinition;
export type AuthzBindingMutationSuccess = z.infer<typeof authzBindingMutationSuccessSchema>;
