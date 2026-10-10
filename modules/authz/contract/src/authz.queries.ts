import {
  authzDenialReasonSchema,
  authzPermissionSchema,
  organizationRoleSchema,
} from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  authzCanScopeRefSchema,
  authzDecisionSchema,
  authzPrincipalRefSchema,
  authzScopeRefSchema,
  collectedGrantsSchema,
  grantScopeTierSchema,
  teamUserRoleSchema,
} from "./authz.ts";

const authzCheckInputSchemaDefinition = z
  .object({
    principal: authzPrincipalRefSchema,
    permission: authzPermissionSchema,
    scope: authzScopeRefSchema,
  })
  .strict();
export interface AuthzCheckInputSchema extends Named<typeof authzCheckInputSchemaDefinition> {}
export const authzCheckInputSchema: AuthzCheckInputSchema = authzCheckInputSchemaDefinition;
export type AuthzCheckInput = z.infer<typeof authzCheckInputSchema>;
/** `can` alone also answers at the platform, from PLATFORM-tier grants only. */
const authzCanInputSchemaDefinition = z
  .object({ ...authzCheckInputSchema.shape, scope: authzCanScopeRefSchema })
  .strict();
export interface AuthzCanInputSchema extends Named<typeof authzCanInputSchemaDefinition> {}
export const authzCanInputSchema: AuthzCanInputSchema = authzCanInputSchemaDefinition;
export type AuthzCanInput = z.infer<typeof authzCanInputSchema>;
export const authzCheckOutputSchema = authzDecisionSchema;
export type AuthzCheckOutput = z.infer<typeof authzCheckOutputSchema>;
export const authzCanOutputSchema = z.boolean();
export type AuthzCanOutput = z.infer<typeof authzCanOutputSchema>;

const authzCheckDetailedOutputSchemaDefinition = z
  .object({ decision: authzDecisionSchema, grants: collectedGrantsSchema })
  .strict();
export interface AuthzCheckDetailedOutputSchema extends Named<
  typeof authzCheckDetailedOutputSchemaDefinition
> {}
export const authzCheckDetailedOutputSchema: AuthzCheckDetailedOutputSchema =
  authzCheckDetailedOutputSchemaDefinition;
export type AuthzCheckDetailedOutput = z.infer<typeof authzCheckDetailedOutputSchema>;

const authzEffectivePermissionsInputSchemaDefinition = z
  .object({ principal: authzPrincipalRefSchema, scope: authzScopeRefSchema })
  .strict();
export interface AuthzEffectivePermissionsInputSchema extends Named<
  typeof authzEffectivePermissionsInputSchemaDefinition
> {}
export const authzEffectivePermissionsInputSchema: AuthzEffectivePermissionsInputSchema =
  authzEffectivePermissionsInputSchemaDefinition;
export type AuthzEffectivePermissionsInput = z.infer<typeof authzEffectivePermissionsInputSchema>;
const authzEffectivePermissionsOutputSchemaDefinition = z.array(authzPermissionSchema);
export interface AuthzEffectivePermissionsOutputSchema extends Named<
  typeof authzEffectivePermissionsOutputSchemaDefinition
> {}
export const authzEffectivePermissionsOutputSchema: AuthzEffectivePermissionsOutputSchema =
  authzEffectivePermissionsOutputSchemaDefinition;
export type AuthzEffectivePermissionsOutput = z.infer<typeof authzEffectivePermissionsOutputSchema>;

const authzScopeIdsSchemaDefinition = z
  .object({
    projectId: z.string().optional(),
    teamId: z.string().optional(),
    organizationId: z.string().optional(),
  })
  .strict();
export interface AuthzScopeIdsSchema extends Named<typeof authzScopeIdsSchemaDefinition> {}
export const authzScopeIdsSchema: AuthzScopeIdsSchema = authzScopeIdsSchemaDefinition;
export type AuthzScopeIds = z.infer<typeof authzScopeIdsSchema>;

export const authzResolveScopeInputSchema = authzScopeIdsSchema;
export type AuthzResolveScopeInput = AuthzScopeIds;
const authzResolveScopeOutputSchemaDefinition = authzScopeRefSchema.nullable();
export interface AuthzResolveScopeOutputSchema extends Named<
  typeof authzResolveScopeOutputSchemaDefinition
> {}
export const authzResolveScopeOutputSchema: AuthzResolveScopeOutputSchema =
  authzResolveScopeOutputSchemaDefinition;
export type AuthzResolveScopeOutput = z.infer<typeof authzResolveScopeOutputSchema>;

const authzCheckByIdsInputSchemaDefinition = authzScopeIdsSchema.safeExtend({
  principal: authzPrincipalRefSchema,
  permission: authzPermissionSchema,
  ceiling: z.boolean().optional(),
});
export interface AuthzCheckByIdsInputSchema extends Named<
  typeof authzCheckByIdsInputSchemaDefinition
> {}
export const authzCheckByIdsInputSchema: AuthzCheckByIdsInputSchema =
  authzCheckByIdsInputSchemaDefinition;
export type AuthzCheckByIdsInput = z.infer<typeof authzCheckByIdsInputSchema>;

const authzCheckByIdsOutputSchemaDefinition = z
  .object({
    allowed: z.boolean(),
    organizationRole: organizationRoleSchema.nullable(),
    denialReason: authzDenialReasonSchema.optional(),
  })
  .strict();
export interface AuthzCheckByIdsOutputSchema extends Named<
  typeof authzCheckByIdsOutputSchemaDefinition
> {}
export const authzCheckByIdsOutputSchema: AuthzCheckByIdsOutputSchema =
  authzCheckByIdsOutputSchemaDefinition;
export type AuthzCheckByIdsOutput = z.infer<typeof authzCheckByIdsOutputSchema>;

const authzCanAnyByIdsInputSchemaDefinition = z
  .object({
    principal: authzPrincipalRefSchema,
    permissions: z.array(authzPermissionSchema).readonly(),
    projectId: z.string(),
  })
  .strict();
export interface AuthzCanAnyByIdsInputSchema extends Named<
  typeof authzCanAnyByIdsInputSchemaDefinition
> {}
export const authzCanAnyByIdsInputSchema: AuthzCanAnyByIdsInputSchema =
  authzCanAnyByIdsInputSchemaDefinition;
export type AuthzCanAnyByIdsInput = z.infer<typeof authzCanAnyByIdsInputSchema>;

const authzCanAnyByIdsOutputSchemaDefinition = z
  .object({
    allowed: z.boolean(),
    matchedPermission: authzPermissionSchema.optional(),
    organizationRole: organizationRoleSchema.nullable(),
    denialReason: authzDenialReasonSchema.optional(),
  })
  .strict();
export interface AuthzCanAnyByIdsOutputSchema extends Named<
  typeof authzCanAnyByIdsOutputSchemaDefinition
> {}
export const authzCanAnyByIdsOutputSchema: AuthzCanAnyByIdsOutputSchema =
  authzCanAnyByIdsOutputSchemaDefinition;
export type AuthzCanAnyByIdsOutput = z.infer<typeof authzCanAnyByIdsOutputSchema>;

const authzCanBatchByIdsInputSchemaDefinition = z
  .object({
    principal: authzPrincipalRefSchema,
    permission: authzPermissionSchema,
    organizationId: z.string(),
    teams: z.array(z.object({ teamId: z.string() }).strict()).readonly(),
    projects: z
      .array(z.object({ projectId: z.string(), teamId: z.string().optional() }).strict())
      .readonly(),
  })
  .strict();
export interface AuthzCanBatchByIdsInputSchema extends Named<
  typeof authzCanBatchByIdsInputSchemaDefinition
> {}
export const authzCanBatchByIdsInputSchema: AuthzCanBatchByIdsInputSchema =
  authzCanBatchByIdsInputSchemaDefinition;
export type AuthzCanBatchByIdsInput = z.infer<typeof authzCanBatchByIdsInputSchema>;

const authzCanBatchByIdsOutputSchemaDefinition = z
  .object({
    teams: z.map(z.string(), z.boolean()),
    projects: z.map(z.string(), z.boolean()),
    organizationRole: organizationRoleSchema.nullable(),
  })
  .strict();
export interface AuthzCanBatchByIdsOutputSchema extends Named<
  typeof authzCanBatchByIdsOutputSchemaDefinition
> {}
export const authzCanBatchByIdsOutputSchema: AuthzCanBatchByIdsOutputSchema =
  authzCanBatchByIdsOutputSchemaDefinition;
export type AuthzCanBatchByIdsOutput = z.infer<typeof authzCanBatchByIdsOutputSchema>;

const authzCanBatchPermissionsByIdsInputSchemaDefinition = z
  .object({
    principal: authzPrincipalRefSchema,
    permissions: z.array(authzPermissionSchema).readonly(),
    organizationId: z.string(),
    teams: z.array(z.object({ teamId: z.string() }).strict()).readonly(),
    projects: z
      .array(z.object({ projectId: z.string(), teamId: z.string().optional() }).strict())
      .readonly(),
  })
  .strict();
export interface AuthzCanBatchPermissionsByIdsInputSchema extends Named<
  typeof authzCanBatchPermissionsByIdsInputSchemaDefinition
> {}
export const authzCanBatchPermissionsByIdsInputSchema: AuthzCanBatchPermissionsByIdsInputSchema =
  authzCanBatchPermissionsByIdsInputSchemaDefinition;
export type AuthzCanBatchPermissionsByIdsInput = z.infer<
  typeof authzCanBatchPermissionsByIdsInputSchema
>;

const authzCanBatchPermissionsByIdsOutputSchemaDefinition = z
  .object({
    byPermission: z.map(
      authzPermissionSchema,
      z.object({
        teams: z.map(z.string(), z.boolean()),
        projects: z.map(z.string(), z.boolean()),
      }),
    ),
    organizationRole: organizationRoleSchema.nullable(),
  })
  .strict();
export interface AuthzCanBatchPermissionsByIdsOutputSchema extends Named<
  typeof authzCanBatchPermissionsByIdsOutputSchemaDefinition
> {}
export const authzCanBatchPermissionsByIdsOutputSchema: AuthzCanBatchPermissionsByIdsOutputSchema =
  authzCanBatchPermissionsByIdsOutputSchemaDefinition;
export type AuthzCanBatchPermissionsByIdsOutput = z.infer<
  typeof authzCanBatchPermissionsByIdsOutputSchema
>;

const authzExplainDecisionInputSchemaDefinition = z
  .object({ decision: authzDecisionSchema })
  .strict();
export interface AuthzExplainDecisionInputSchema extends Named<
  typeof authzExplainDecisionInputSchemaDefinition
> {}
export const authzExplainDecisionInputSchema: AuthzExplainDecisionInputSchema =
  authzExplainDecisionInputSchemaDefinition;
export type AuthzExplainDecisionInput = z.infer<typeof authzExplainDecisionInputSchema>;
const authzExplainDecisionOutputSchemaDefinition = z.array(z.string());
export interface AuthzExplainDecisionOutputSchema extends Named<
  typeof authzExplainDecisionOutputSchemaDefinition
> {}
export const authzExplainDecisionOutputSchema: AuthzExplainDecisionOutputSchema =
  authzExplainDecisionOutputSchemaDefinition;
export type AuthzExplainDecisionOutput = z.infer<typeof authzExplainDecisionOutputSchema>;

const authzPermissionByIdsInputSchemaDefinition = z
  .object({
    userId: z.string(),
    permission: authzPermissionSchema,
    projectId: z.string().optional(),
    teamId: z.string().optional(),
    organizationId: z.string().optional(),
  })
  .strict()
  .refine(
    (value) => [value.projectId, value.teamId, value.organizationId].filter(Boolean).length === 1,
    { message: "exactly one scope id is required" },
  );
export interface AuthzPermissionByIdsInputSchema extends Named<
  typeof authzPermissionByIdsInputSchemaDefinition
> {}
export const authzPermissionByIdsInputSchema: AuthzPermissionByIdsInputSchema =
  authzPermissionByIdsInputSchemaDefinition;
export type AuthzPermissionByIdsInput = z.infer<typeof authzPermissionByIdsInputSchema>;

const authzRequireProjectPermissionInputSchemaDefinition = z
  .object({
    userId: z.string(),
    projectId: z.string(),
    permission: authzPermissionSchema,
  })
  .strict();
export interface AuthzRequireProjectPermissionInputSchema extends Named<
  typeof authzRequireProjectPermissionInputSchemaDefinition
> {}
export const authzRequireProjectPermissionInputSchema: AuthzRequireProjectPermissionInputSchema =
  authzRequireProjectPermissionInputSchemaDefinition;
export type AuthzRequireProjectPermissionInput = z.infer<
  typeof authzRequireProjectPermissionInputSchema
>;

const apiKeyPermissionScopeSchemaDefinition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("org"), id: z.string() }).strict(),
  z.object({ type: z.literal("team"), id: z.string() }).strict(),
  z.object({ type: z.literal("project"), id: z.string(), teamId: z.string() }).strict(),
]);
export interface ApiKeyPermissionScopeSchema extends Named<
  typeof apiKeyPermissionScopeSchemaDefinition
> {}
export const apiKeyPermissionScopeSchema: ApiKeyPermissionScopeSchema =
  apiKeyPermissionScopeSchemaDefinition;
export type ApiKeyPermissionScope = z.infer<typeof apiKeyPermissionScopeSchema>;

const apiKeyPermissionCheckSchemaDefinition = z
  .object({
    apiKeyId: z.string(),
    userId: z.string().nullable(),
    organizationId: z.string(),
    scope: apiKeyPermissionScopeSchema,
    permission: authzPermissionSchema,
  })
  .strict();
export interface ApiKeyPermissionCheckSchema extends Named<
  typeof apiKeyPermissionCheckSchemaDefinition
> {}
export const apiKeyPermissionCheckSchema: ApiKeyPermissionCheckSchema =
  apiKeyPermissionCheckSchemaDefinition;
export type ApiKeyPermissionCheck = z.infer<typeof apiKeyPermissionCheckSchema>;

const authzGetApiKeyProjectDecisionInputSchemaDefinition = z
  .object({
    apiKeyId: z.string(),
    userId: z.string().nullable(),
    organizationId: z.string(),
    projectId: z.string(),
    permission: authzPermissionSchema,
  })
  .strict();
export interface AuthzGetApiKeyProjectDecisionInputSchema extends Named<
  typeof authzGetApiKeyProjectDecisionInputSchemaDefinition
> {}
export const authzGetApiKeyProjectDecisionInputSchema: AuthzGetApiKeyProjectDecisionInputSchema =
  authzGetApiKeyProjectDecisionInputSchemaDefinition;
export type AuthzGetApiKeyProjectDecisionInput = z.infer<
  typeof authzGetApiKeyProjectDecisionInputSchema
>;

const authzProjectScopeSchemaDefinition = z
  .object({
    projectId: z.string(),
    teamId: z.string(),
    organizationId: z.string(),
  })
  .strict();
export interface AuthzProjectScopeSchema extends Named<typeof authzProjectScopeSchemaDefinition> {}
export const authzProjectScopeSchema: AuthzProjectScopeSchema = authzProjectScopeSchemaDefinition;
export type AuthzProjectScope = z.infer<typeof authzProjectScopeSchema>;

const apiKeyProjectDecisionSchemaDefinition = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("project_not_found") }).strict(),
  z.object({ outcome: z.literal("denied") }).strict(),
  z.object({ outcome: z.literal("allowed"), scope: authzProjectScopeSchema }).strict(),
]);
export interface ApiKeyProjectDecisionSchema extends Named<
  typeof apiKeyProjectDecisionSchemaDefinition
> {}
export const apiKeyProjectDecisionSchema: ApiKeyProjectDecisionSchema =
  apiKeyProjectDecisionSchemaDefinition;
export type ApiKeyProjectDecision = z.infer<typeof apiKeyProjectDecisionSchema>;

const nullableTextSchema = z.string().nullable();
const authzAccessUserSchemaDefinition = z
  .object({
    id: z.string(),
    name: nullableTextSchema,
    email: nullableTextSchema,
    image: nullableTextSchema,
  })
  .passthrough();
export interface AuthzAccessUserSchema extends Named<typeof authzAccessUserSchemaDefinition> {}
export const authzAccessUserSchema: AuthzAccessUserSchema = authzAccessUserSchemaDefinition;
export type AuthzAccessUser = z.infer<typeof authzAccessUserSchema>;

const authzAccessGroupSchemaDefinition = z
  .object({
    id: z.string(),
    name: z.string(),
    scimSource: nullableTextSchema,
  })
  .passthrough();
export interface AuthzAccessGroupSchema extends Named<typeof authzAccessGroupSchemaDefinition> {}
export const authzAccessGroupSchema: AuthzAccessGroupSchema = authzAccessGroupSchemaDefinition;
export type AuthzAccessGroup = z.infer<typeof authzAccessGroupSchema>;

const authzAccessApiKeySchemaDefinition = z
  .object({ id: z.string(), name: z.string() })
  .passthrough();
export interface AuthzAccessApiKeySchema extends Named<typeof authzAccessApiKeySchemaDefinition> {}
export const authzAccessApiKeySchema: AuthzAccessApiKeySchema = authzAccessApiKeySchemaDefinition;
export type AuthzAccessApiKey = z.infer<typeof authzAccessApiKeySchema>;

const authzCustomRoleSchemaDefinition = z
  .object({
    id: z.string(),
    name: z.string(),
    description: nullableTextSchema,
    permissions: z.unknown(),
    organizationId: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .passthrough();
export interface AuthzCustomRoleSchema extends Named<typeof authzCustomRoleSchemaDefinition> {}
export const authzCustomRoleSchema: AuthzCustomRoleSchema = authzCustomRoleSchemaDefinition;
export type AuthzCustomRole = z.infer<typeof authzCustomRoleSchema>;

const authzAccessBindingSchemaDefinition = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    userId: z.string().nullable(),
    groupId: z.string().nullable(),
    apiKeyId: z.string().nullable(),
    role: teamUserRoleSchema,
    customRoleId: z.string().nullable(),
    scopeType: grantScopeTierSchema,
    scopeId: z.string(),
    createdAt: z.date(),
    expiresAt: z.date().nullable().optional(),
    user: authzAccessUserSchema.nullable(),
    group: authzAccessGroupSchema.nullable(),
    apiKey: authzAccessApiKeySchema.nullable(),
    customRole: authzCustomRoleSchema.nullable(),
  })
  .strict();
export interface AuthzAccessBindingSchema extends Named<
  typeof authzAccessBindingSchemaDefinition
> {}
export const authzAccessBindingSchema: AuthzAccessBindingSchema =
  authzAccessBindingSchemaDefinition;
export type AuthzAccessBinding = z.infer<typeof authzAccessBindingSchema>;

const authzTeamMemberBindingSchemaDefinition = z
  .object({
    userId: z.string(),
    role: teamUserRoleSchema,
    customRoleId: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    user: authzAccessUserSchema,
    customRole: authzCustomRoleSchema.nullable(),
  })
  .strict();
export interface AuthzTeamMemberBindingSchema extends Named<
  typeof authzTeamMemberBindingSchemaDefinition
> {}
export const authzTeamMemberBindingSchema: AuthzTeamMemberBindingSchema =
  authzTeamMemberBindingSchemaDefinition;
export type AuthzTeamMemberBinding = z.infer<typeof authzTeamMemberBindingSchema>;

const authzBindingForSynthesisSchemaDefinition = z
  .object({
    organizationId: z.string(),
    scopeType: grantScopeTierSchema,
    scopeId: z.string(),
    role: teamUserRoleSchema,
    customRoleId: z.string().nullable(),
    customRole: authzCustomRoleSchema.nullable(),
  })
  .strict();
export interface AuthzBindingForSynthesisSchema extends Named<
  typeof authzBindingForSynthesisSchemaDefinition
> {}
export const authzBindingForSynthesisSchema: AuthzBindingForSynthesisSchema =
  authzBindingForSynthesisSchemaDefinition;
export type AuthzBindingForSynthesis = z.infer<typeof authzBindingForSynthesisSchema>;

const authzListUserBindingsInputSchemaDefinition = z
  .object({ organizationId: z.string(), userId: z.string() })
  .strict();
export interface AuthzListUserBindingsInputSchema extends Named<
  typeof authzListUserBindingsInputSchemaDefinition
> {}
export const authzListUserBindingsInputSchema: AuthzListUserBindingsInputSchema =
  authzListUserBindingsInputSchemaDefinition;
export type AuthzListUserBindingsInput = z.infer<typeof authzListUserBindingsInputSchema>;

const authzListOrganizationBindingsInputSchemaDefinition = z
  .object({ organizationId: z.string() })
  .strict();
export interface AuthzListOrganizationBindingsInputSchema extends Named<
  typeof authzListOrganizationBindingsInputSchemaDefinition
> {}
export const authzListOrganizationBindingsInputSchema: AuthzListOrganizationBindingsInputSchema =
  authzListOrganizationBindingsInputSchemaDefinition;
export type AuthzListOrganizationBindingsInput = z.infer<
  typeof authzListOrganizationBindingsInputSchema
>;

/** Asks for the members who administer an organisation and can still sign in to it. */
const authzFindActiveOrganizationAdministratorsInputSchemaDefinition = z
  .object({ organizationId: z.string() })
  .strict();
export interface AuthzFindActiveOrganizationAdministratorsInputSchema extends Named<
  typeof authzFindActiveOrganizationAdministratorsInputSchemaDefinition
> {}
export const authzFindActiveOrganizationAdministratorsInputSchema: AuthzFindActiveOrganizationAdministratorsInputSchema =
  authzFindActiveOrganizationAdministratorsInputSchemaDefinition;
export type AuthzFindActiveOrganizationAdministratorsInput = z.infer<
  typeof authzFindActiveOrganizationAdministratorsInputSchema
>;

/** The user ids of those administrators: organisation role ADMIN on a seat not disabled. */
const authzActiveOrganizationAdministratorsSchemaDefinition = z.array(z.string());
export interface AuthzActiveOrganizationAdministratorsSchema extends Named<
  typeof authzActiveOrganizationAdministratorsSchemaDefinition
> {}
export const authzActiveOrganizationAdministratorsSchema: AuthzActiveOrganizationAdministratorsSchema =
  authzActiveOrganizationAdministratorsSchemaDefinition;
export type AuthzActiveOrganizationAdministrators = z.infer<
  typeof authzActiveOrganizationAdministratorsSchema
>;

const authzListUserAndGroupBindingsInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    userId: z.string(),
    groupIds: z.array(z.string()).readonly(),
  })
  .strict();
export interface AuthzListUserAndGroupBindingsInputSchema extends Named<
  typeof authzListUserAndGroupBindingsInputSchemaDefinition
> {}
export const authzListUserAndGroupBindingsInputSchema: AuthzListUserAndGroupBindingsInputSchema =
  authzListUserAndGroupBindingsInputSchemaDefinition;
export type AuthzListUserAndGroupBindingsInput = z.infer<
  typeof authzListUserAndGroupBindingsInputSchema
>;

const authzListScopeBindingsInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    scopeType: grantScopeTierSchema,
    scopeIds: z.array(z.string()).readonly(),
  })
  .strict();
export interface AuthzListScopeBindingsInputSchema extends Named<
  typeof authzListScopeBindingsInputSchemaDefinition
> {}
export const authzListScopeBindingsInputSchema: AuthzListScopeBindingsInputSchema =
  authzListScopeBindingsInputSchemaDefinition;
export type AuthzListScopeBindingsInput = z.infer<typeof authzListScopeBindingsInputSchema>;

/** The bindings of keys the caller already loaded from this organization. */
const authzListApiKeyBindingsInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    apiKeyIds: z.array(z.string()).readonly(),
  })
  .strict();
export interface AuthzListApiKeyBindingsInputSchema extends Named<
  typeof authzListApiKeyBindingsInputSchemaDefinition
> {}
export const authzListApiKeyBindingsInputSchema: AuthzListApiKeyBindingsInputSchema =
  authzListApiKeyBindingsInputSchemaDefinition;
export type AuthzListApiKeyBindingsInput = z.infer<typeof authzListApiKeyBindingsInputSchema>;

const authzListGroupBindingsInputSchemaDefinition = z
  .object({ organizationId: z.string(), groupId: z.string() })
  .strict();
export interface AuthzListGroupBindingsInputSchema extends Named<
  typeof authzListGroupBindingsInputSchemaDefinition
> {}
export const authzListGroupBindingsInputSchema: AuthzListGroupBindingsInputSchema =
  authzListGroupBindingsInputSchemaDefinition;
export type AuthzListGroupBindingsInput = z.infer<typeof authzListGroupBindingsInputSchema>;

const authzListTeamMemberBindingsInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    teamIds: z.array(z.string()).readonly(),
  })
  .strict();
export interface AuthzListTeamMemberBindingsInputSchema extends Named<
  typeof authzListTeamMemberBindingsInputSchemaDefinition
> {}
export const authzListTeamMemberBindingsInputSchema: AuthzListTeamMemberBindingsInputSchema =
  authzListTeamMemberBindingsInputSchemaDefinition;
export type AuthzListTeamMemberBindingsInput = z.infer<
  typeof authzListTeamMemberBindingsInputSchema
>;

const authzListBindingsForSynthesisInputSchemaDefinition = z
  .object({ orgIds: z.array(z.string()).readonly(), userId: z.string() })
  .strict();
export interface AuthzListBindingsForSynthesisInputSchema extends Named<
  typeof authzListBindingsForSynthesisInputSchemaDefinition
> {}
export const authzListBindingsForSynthesisInputSchema: AuthzListBindingsForSynthesisInputSchema =
  authzListBindingsForSynthesisInputSchemaDefinition;
export type AuthzListBindingsForSynthesisInput = z.infer<
  typeof authzListBindingsForSynthesisInputSchema
>;

const authzAccessBindingsOutputSchemaDefinition = z.array(authzAccessBindingSchema);
export interface AuthzAccessBindingsOutputSchema extends Named<
  typeof authzAccessBindingsOutputSchemaDefinition
> {}
export const authzAccessBindingsOutputSchema: AuthzAccessBindingsOutputSchema =
  authzAccessBindingsOutputSchemaDefinition;
export type AuthzAccessBindingsOutput = z.infer<typeof authzAccessBindingsOutputSchema>;

const authzTeamMemberBindingsOutputSchemaDefinition = z.map(
  z.string(),
  z.array(authzTeamMemberBindingSchema),
);
export interface AuthzTeamMemberBindingsOutputSchema extends Named<
  typeof authzTeamMemberBindingsOutputSchemaDefinition
> {}
export const authzTeamMemberBindingsOutputSchema: AuthzTeamMemberBindingsOutputSchema =
  authzTeamMemberBindingsOutputSchemaDefinition;
export type AuthzTeamMemberBindingsOutput = z.infer<typeof authzTeamMemberBindingsOutputSchema>;

const authzBindingsForSynthesisOutputSchemaDefinition = z.array(authzBindingForSynthesisSchema);
export interface AuthzBindingsForSynthesisOutputSchema extends Named<
  typeof authzBindingsForSynthesisOutputSchemaDefinition
> {}
export const authzBindingsForSynthesisOutputSchema: AuthzBindingsForSynthesisOutputSchema =
  authzBindingsForSynthesisOutputSchemaDefinition;
export type AuthzBindingsForSynthesisOutput = z.infer<typeof authzBindingsForSynthesisOutputSchema>;

const authzCustomRolesOutputSchemaDefinition = z.array(authzCustomRoleSchema);
export interface AuthzCustomRolesOutputSchema extends Named<
  typeof authzCustomRolesOutputSchemaDefinition
> {}
export const authzCustomRolesOutputSchema: AuthzCustomRolesOutputSchema =
  authzCustomRolesOutputSchemaDefinition;
export type AuthzCustomRolesOutput = z.infer<typeof authzCustomRolesOutputSchema>;

const authzFindRolePermissionsInputSchemaDefinition = z
  .object({ organizationId: z.string(), roleIds: z.array(z.string()) })
  .strict();
export interface AuthzFindRolePermissionsInputSchema extends Named<
  typeof authzFindRolePermissionsInputSchemaDefinition
> {}
export const authzFindRolePermissionsInputSchema: AuthzFindRolePermissionsInputSchema =
  authzFindRolePermissionsInputSchemaDefinition;
export type AuthzFindRolePermissionsInput = z.infer<typeof authzFindRolePermissionsInputSchema>;

/** One live role of any kind, a key's private role included, with its permission set. */
const authzRolePermissionsSchemaDefinition = z
  .object({ id: z.string(), name: z.string(), permissions: z.array(z.string()) })
  .strict();
export interface AuthzRolePermissionsSchema extends Named<
  typeof authzRolePermissionsSchemaDefinition
> {}
export const authzRolePermissionsSchema: AuthzRolePermissionsSchema =
  authzRolePermissionsSchemaDefinition;
export type AuthzRolePermissions = z.infer<typeof authzRolePermissionsSchema>;

/** The scope an own-standing read resolved to, by kind and id. */
const authzResolvedScopeSchema = z
  .object({
    type: z.union([
      authzScopeRefSchema.options[0].shape.type,
      authzScopeRefSchema.options[1].shape.type,
      authzScopeRefSchema.options[2].shape.type,
      authzScopeRefSchema.options[3].shape.type,
    ]),
    id: z.string(),
  })
  .strict();

/**
 * The caller's OWN standing at one scope. A scope they have no standing in —
 * or one that does not resolve at all — answers a null scope and the empty
 * set, which is the engine's no-default-access rather than a special case.
 */
const authzOwnStandingSchemaDefinition = z
  .object({
    scope: authzResolvedScopeSchema.nullable(),
    permissions: z.array(z.string()),
  })
  .strict();
export interface AuthzOwnStandingSchema extends Named<typeof authzOwnStandingSchemaDefinition> {}
export const authzOwnStandingSchema: AuthzOwnStandingSchema = authzOwnStandingSchemaDefinition;
export type AuthzOwnStanding = z.infer<typeof authzOwnStandingSchema>;

/**
 * Which scope the standing is asked about. Both ids are optional and neither
 * is checked: a scope the caller holds nothing in resolves to the empty set
 * rather than to anything about it.
 */
const authzOwnStandingInputSchemaDefinition = z.object({
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
});
export interface AuthzOwnStandingInputSchema extends Named<
  typeof authzOwnStandingInputSchemaDefinition
> {}
export const authzOwnStandingInputSchema: AuthzOwnStandingInputSchema =
  authzOwnStandingInputSchemaDefinition;
export type AuthzOwnStandingInput = z.infer<typeof authzOwnStandingInputSchema>;
