import { z } from "zod";
import {
  authzDecisionSchema,
  authzPrincipalRefSchema,
  authzScopeRefSchema,
  collectedGrantsSchema,
  declaredScopeIdSchema,
  organizationRoleSchema,
  roleBindingScopeTypeSchema,
  teamUserRoleSchema,
} from "./authz";
import { authzPermissionSchema } from "./registry";

export const authzCheckInputSchema = z
  .object({
    principal: authzPrincipalRefSchema,
    permission: authzPermissionSchema,
    scope: authzScopeRefSchema,
  })
  .strict();
export type AuthzCheckInput = z.infer<typeof authzCheckInputSchema>;
export const authzCheckOutputSchema = authzDecisionSchema;
export type AuthzCheckOutput = z.infer<typeof authzCheckOutputSchema>;
export const authzCanOutputSchema = z.boolean();
export type AuthzCanOutput = z.infer<typeof authzCanOutputSchema>;

export const authzCheckDetailedOutputSchema = z
  .object({ decision: authzDecisionSchema, grants: collectedGrantsSchema })
  .strict();
export type AuthzCheckDetailedOutput = z.infer<typeof authzCheckDetailedOutputSchema>;

export const authzEffectivePermissionsInputSchema = z
  .object({ principal: authzPrincipalRefSchema, scope: authzScopeRefSchema })
  .strict();
export type AuthzEffectivePermissionsInput = z.infer<
  typeof authzEffectivePermissionsInputSchema
>;
export const authzEffectivePermissionsOutputSchema = z.array(authzPermissionSchema);
export type AuthzEffectivePermissionsOutput = z.infer<
  typeof authzEffectivePermissionsOutputSchema
>;

export const authzScopeIdsSchema = z
  .object({
    projectId: z.string().optional(),
    teamId: z.string().optional(),
    organizationId: z.string().optional(),
  })
  .strict();
export type AuthzScopeIds = z.infer<typeof authzScopeIdsSchema>;

export const authzResolveScopeInputSchema = authzScopeIdsSchema;
export type AuthzResolveScopeInput = AuthzScopeIds;
export const authzResolveScopeOutputSchema = authzScopeRefSchema.nullable();
export type AuthzResolveScopeOutput = z.infer<typeof authzResolveScopeOutputSchema>;

export const authzCheckByIdsInputSchema = authzScopeIdsSchema.extend({
  principal: authzPrincipalRefSchema,
  permission: authzPermissionSchema,
  ceiling: z.boolean().optional(),
});
export type AuthzCheckByIdsInput = z.infer<typeof authzCheckByIdsInputSchema>;

export const permissionDecisionSchema = z
  .object({
    permitted: z.boolean(),
    organizationRole: organizationRoleSchema.nullable(),
  })
  .strict();
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;

export const authzCheckByIdsOutputSchema = z
  .object({
    allowed: z.boolean(),
    organizationRole: organizationRoleSchema.nullable(),
  })
  .strict();
export type AuthzCheckByIdsOutput = z.infer<typeof authzCheckByIdsOutputSchema>;

export const authzCanAnyByIdsInputSchema = z
  .object({
    principal: authzPrincipalRefSchema,
    permissions: z.array(authzPermissionSchema).readonly(),
    projectId: z.string(),
  })
  .strict();
export type AuthzCanAnyByIdsInput = z.infer<typeof authzCanAnyByIdsInputSchema>;

export const authzCanAnyByIdsOutputSchema = z
  .object({
    allowed: z.boolean(),
    matchedPermission: authzPermissionSchema.optional(),
    organizationRole: organizationRoleSchema.nullable(),
  })
  .strict();
export type AuthzCanAnyByIdsOutput = z.infer<typeof authzCanAnyByIdsOutputSchema>;

export const authzCanBatchByIdsInputSchema = z
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
export type AuthzCanBatchByIdsInput = z.infer<typeof authzCanBatchByIdsInputSchema>;

export const authzCanBatchByIdsOutputSchema = z
  .object({
    teams: z.map(z.string(), z.boolean()),
    projects: z.map(z.string(), z.boolean()),
    organizationRole: organizationRoleSchema.nullable(),
  })
  .strict();
export type AuthzCanBatchByIdsOutput = z.infer<typeof authzCanBatchByIdsOutputSchema>;

export const authzExplainDecisionInputSchema = z
  .object({ decision: authzDecisionSchema })
  .strict();
export type AuthzExplainDecisionInput = z.infer<typeof authzExplainDecisionInputSchema>;
export const authzExplainDecisionOutputSchema = z.array(z.string());
export type AuthzExplainDecisionOutput = z.infer<typeof authzExplainDecisionOutputSchema>;

export const authzGetDecisionInputSchema = z
  .object({
    userId: z.string(),
    permission: authzPermissionSchema,
    scope: declaredScopeIdSchema,
  })
  .strict();
export type AuthzGetDecisionInput = z.infer<typeof authzGetDecisionInputSchema>;

export const authzGetProjectAnyDecisionInputSchema = z
  .object({
    userId: z.string(),
    projectId: z.string(),
    permissions: z.array(authzPermissionSchema).readonly(),
  })
  .strict();
export type AuthzGetProjectAnyDecisionInput = z.infer<
  typeof authzGetProjectAnyDecisionInputSchema
>;

export const authzPermissionByIdsInputSchema = z
  .object({
    userId: z.string(),
    permission: authzPermissionSchema,
    projectId: z.string().optional(),
    teamId: z.string().optional(),
    organizationId: z.string().optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.projectId, value.teamId, value.organizationId].filter(Boolean).length === 1,
    { message: "exactly one scope id is required" },
  );
export type AuthzPermissionByIdsInput = z.infer<typeof authzPermissionByIdsInputSchema>;

export const authzRequireProjectPermissionInputSchema = z
  .object({
    userId: z.string(),
    projectId: z.string(),
    permission: authzPermissionSchema,
  })
  .strict();
export type AuthzRequireProjectPermissionInput = z.infer<
  typeof authzRequireProjectPermissionInputSchema
>;

export const apiKeyPermissionScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("org"), id: z.string() }).strict(),
  z.object({ type: z.literal("team"), id: z.string() }).strict(),
  z.object({ type: z.literal("project"), id: z.string(), teamId: z.string() }).strict(),
]);
export type ApiKeyPermissionScope = z.infer<typeof apiKeyPermissionScopeSchema>;

export const apiKeyPermissionCheckSchema = z
  .object({
    apiKeyId: z.string(),
    userId: z.string().nullable(),
    organizationId: z.string(),
    scope: apiKeyPermissionScopeSchema,
    permission: authzPermissionSchema,
  })
  .strict();
export type ApiKeyPermissionCheck = z.infer<typeof apiKeyPermissionCheckSchema>;

export const authzGetApiKeyProjectDecisionInputSchema = z
  .object({
    apiKeyId: z.string(),
    userId: z.string().nullable(),
    organizationId: z.string(),
    projectId: z.string(),
    permission: authzPermissionSchema,
  })
  .strict();
export type AuthzGetApiKeyProjectDecisionInput = z.infer<
  typeof authzGetApiKeyProjectDecisionInputSchema
>;

export const authzProjectScopeSchema = z
  .object({
    projectId: z.string(),
    teamId: z.string(),
    organizationId: z.string(),
  })
  .strict();
export type AuthzProjectScope = z.infer<typeof authzProjectScopeSchema>;

export const apiKeyProjectDecisionSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("project_not_found") }).strict(),
  z.object({ outcome: z.literal("denied") }).strict(),
  z.object({ outcome: z.literal("allowed"), scope: authzProjectScopeSchema }).strict(),
]);
export type ApiKeyProjectDecision = z.infer<typeof apiKeyProjectDecisionSchema>;

const nullableTextSchema = z.string().nullable();
export const authzAccessUserSchema = z
  .object({
    id: z.string(),
    name: nullableTextSchema,
    email: nullableTextSchema,
    image: nullableTextSchema,
  })
  .passthrough();
export type AuthzAccessUser = z.infer<typeof authzAccessUserSchema>;

export const authzAccessGroupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    scimSource: nullableTextSchema,
  })
  .passthrough();
export type AuthzAccessGroup = z.infer<typeof authzAccessGroupSchema>;

export const authzAccessApiKeySchema = z
  .object({ id: z.string(), name: z.string() })
  .passthrough();
export type AuthzAccessApiKey = z.infer<typeof authzAccessApiKeySchema>;

export const authzCustomRoleSchema = z
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
export type AuthzCustomRole = z.infer<typeof authzCustomRoleSchema>;

export const authzAccessBindingSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    userId: z.string().nullable(),
    groupId: z.string().nullable(),
    apiKeyId: z.string().nullable(),
    role: teamUserRoleSchema,
    customRoleId: z.string().nullable(),
    scopeType: roleBindingScopeTypeSchema,
    scopeId: z.string(),
    createdAt: z.date(),
    user: authzAccessUserSchema.nullable(),
    group: authzAccessGroupSchema.nullable(),
    apiKey: authzAccessApiKeySchema.nullable(),
    customRole: authzCustomRoleSchema.nullable(),
  })
  .strict();
export type AuthzAccessBinding = z.infer<typeof authzAccessBindingSchema>;

export const authzTeamMemberBindingSchema = z
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
export type AuthzTeamMemberBinding = z.infer<typeof authzTeamMemberBindingSchema>;

export const authzBindingForSynthesisSchema = z
  .object({
    organizationId: z.string(),
    scopeType: roleBindingScopeTypeSchema,
    scopeId: z.string(),
    role: teamUserRoleSchema,
    customRoleId: z.string().nullable(),
    customRole: authzCustomRoleSchema.nullable(),
  })
  .strict();
export type AuthzBindingForSynthesis = z.infer<typeof authzBindingForSynthesisSchema>;

export const authzListUserBindingsInputSchema = z
  .object({ organizationId: z.string(), userId: z.string() })
  .strict();
export type AuthzListUserBindingsInput = z.infer<typeof authzListUserBindingsInputSchema>;

export const authzListOrganizationBindingsInputSchema = z
  .object({ organizationId: z.string() })
  .strict();
export type AuthzListOrganizationBindingsInput = z.infer<
  typeof authzListOrganizationBindingsInputSchema
>;

export const authzListUserAndGroupBindingsInputSchema = z
  .object({
    organizationId: z.string(),
    userId: z.string(),
    groupIds: z.array(z.string()).readonly(),
  })
  .strict();
export type AuthzListUserAndGroupBindingsInput = z.infer<
  typeof authzListUserAndGroupBindingsInputSchema
>;

export const authzListScopeBindingsInputSchema = z
  .object({
    organizationId: z.string(),
    scopeType: roleBindingScopeTypeSchema,
    scopeIds: z.array(z.string()).readonly(),
  })
  .strict();
export type AuthzListScopeBindingsInput = z.infer<
  typeof authzListScopeBindingsInputSchema
>;

export const authzListGroupBindingsInputSchema = z
  .object({ organizationId: z.string(), groupId: z.string() })
  .strict();
export type AuthzListGroupBindingsInput = z.infer<
  typeof authzListGroupBindingsInputSchema
>;

export const authzListTeamMemberBindingsInputSchema = z
  .object({
    organizationId: z.string(),
    teamIds: z.array(z.string()).readonly(),
  })
  .strict();
export type AuthzListTeamMemberBindingsInput = z.infer<
  typeof authzListTeamMemberBindingsInputSchema
>;

export const authzListBindingsForSynthesisInputSchema = z
  .object({ orgIds: z.array(z.string()).readonly(), userId: z.string() })
  .strict();
export type AuthzListBindingsForSynthesisInput = z.infer<
  typeof authzListBindingsForSynthesisInputSchema
>;

export const authzAccessBindingsOutputSchema = z.array(authzAccessBindingSchema);
export type AuthzAccessBindingsOutput = z.infer<typeof authzAccessBindingsOutputSchema>;

export const authzTeamMemberBindingsOutputSchema = z.map(
  z.string(),
  z.array(authzTeamMemberBindingSchema),
);
export type AuthzTeamMemberBindingsOutput = z.infer<
  typeof authzTeamMemberBindingsOutputSchema
>;

export const authzBindingsForSynthesisOutputSchema = z.array(
  authzBindingForSynthesisSchema,
);
export type AuthzBindingsForSynthesisOutput = z.infer<
  typeof authzBindingsForSynthesisOutputSchema
>;

export const authzCustomRolesOutputSchema = z.array(authzCustomRoleSchema);
export type AuthzCustomRolesOutput = z.infer<typeof authzCustomRolesOutputSchema>;
