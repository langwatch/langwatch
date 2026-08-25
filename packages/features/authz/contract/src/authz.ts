import { z } from "zod";
import { authzPermissionSchema, shareableResourceKindSchema } from "./registry";
import { bindingScopeTierSchema, storedBindingScopeTierSchema } from "./vocabulary";

/** Portable AuthZ vocabulary. Persisted and transport values validate here. */
export const teamUserRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
export type TeamUserRole = z.infer<typeof teamUserRoleSchema>;

export const organizationRoleSchema = z.enum(["ADMIN", "MEMBER", "EXTERNAL"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const roleBindingScopeTypeSchema = storedBindingScopeTierSchema;
export type RoleBindingScopeType = z.infer<typeof roleBindingScopeTypeSchema>;

const projectScopeRefSchema = z
  .object({
    type: z.literal("project"),
    id: z.string(),
    teamId: z.string(),
    organizationId: z.string(),
  })
  .strict();

const teamScopeRefSchema = z
  .object({
    type: z.literal("team"),
    id: z.string(),
    organizationId: z.string(),
  })
  .strict();

const organizationScopeRefSchema = z
  .object({ type: z.literal("organization"), id: z.string() })
  .strict();

export const grantableAuthzScopeRefSchema = z.discriminatedUnion("type", [
  projectScopeRefSchema,
  teamScopeRefSchema,
  organizationScopeRefSchema,
]);
export type GrantableAuthzScopeRef = z.infer<typeof grantableAuthzScopeRefSchema>;

const resourceParentSchema = z
  .object({ kind: shareableResourceKindSchema, id: z.string() })
  .strict();

const resourceScopeRefSchema = z
  .object({
    type: z.literal("resource"),
    kind: shareableResourceKindSchema,
    id: z.string(),
    parents: z.array(resourceParentSchema).readonly().optional(),
    shareTokens: z.array(z.string()).readonly().optional(),
    projectId: z.string(),
    teamId: z.string(),
    organizationId: z.string(),
  })
  .strict();

export const authzScopeRefSchema = z.discriminatedUnion("type", [
  projectScopeRefSchema,
  teamScopeRefSchema,
  organizationScopeRefSchema,
  resourceScopeRefSchema,
]);
export type AuthzScopeRef = z.infer<typeof authzScopeRefSchema>;

export const declaredScopeIdSchema = z.discriminatedUnion("tier", [
  z.object({ tier: z.literal("project"), id: z.string() }).strict(),
  z.object({ tier: z.literal("team"), id: z.string() }).strict(),
  z.object({ tier: z.literal("organization"), id: z.string() }).strict(),
]);
export type AuthzDeclaredScopeId = z.infer<typeof declaredScopeIdSchema>;

export const authzPrincipalRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), id: z.string() }).strict(),
  z.object({ type: z.literal("apiKey"), id: z.string() }).strict(),
  z.object({ type: z.literal("anonymous") }).strict(),
]);
export type AuthzPrincipalRef = z.infer<typeof authzPrincipalRefSchema>;

export const grantAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: z.string() }).strict(),
  z.object({ kind: z.literal("apiKey"), id: z.string() }).strict(),
  z.object({ kind: z.literal("group"), id: z.string() }).strict(),
  z.object({ kind: z.literal("team"), id: z.string() }).strict(),
  z.object({ kind: z.literal("project"), id: z.string() }).strict(),
  z.object({ kind: z.literal("organization"), id: z.string() }).strict(),
  z.object({ kind: z.literal("anyone") }).strict(),
]);
export type GrantAudience = z.infer<typeof grantAudienceSchema>;

export const resourceGrantSchema = z
  .object({
    kind: shareableResourceKindSchema,
    id: z.string(),
    projectId: z.string(),
    // Legacy rows may carry unknown strings. New write schemas are stricter.
    permission: z.string(),
    audience: grantAudienceSchema,
  })
  .strict();
export type ResourceGrant = z.infer<typeof resourceGrantSchema>;

export const collectedBindingSchema = z
  .object({
    role: teamUserRoleSchema,
    customRoleId: z.string().nullable(),
    scopeType: roleBindingScopeTypeSchema,
    scopeId: z.string(),
    viaGroupId: z.string().nullable().optional(),
  })
  .strict();
export type CollectedBinding = z.infer<typeof collectedBindingSchema>;

export const legacyTeamMembershipSchema = z
  .object({
    teamId: z.string(),
    role: teamUserRoleSchema,
    customRoleId: z.string().nullable(),
    isPersonal: z.boolean(),
  })
  .strict();
export type LegacyTeamMembership = z.infer<typeof legacyTeamMembershipSchema>;

const customRolePermissionsSchema = z
  .map(z.string(), z.array(z.string()).readonly())
  .transform((permissions): ReadonlyMap<string, readonly string[]> => permissions);

export const collectedGrantsSchema = z
  .object({
    principal: authzPrincipalRefSchema,
    organizationId: z.string(),
    organizationRole: organizationRoleSchema.nullable(),
    isOrgMember: z.boolean(),
    bindings: z.array(collectedBindingSchema),
    legacyTeamMemberships: z.array(legacyTeamMembershipSchema),
    customRolePermissions: customRolePermissionsSchema,
  })
  .strict();
export type CollectedGrants = z.infer<typeof collectedGrantsSchema>;

export const authzDenialReasonSchema = z.enum([
  "no-membership",
  "no-binding",
  "lite-member-restricted",
  "owner-ceiling",
]);
export type AuthzDenialReason = z.infer<typeof authzDenialReasonSchema>;

export const authzGrantViaSchema = z.enum([
  "binding",
  "org-role-floor",
  "demo-project",
  "legacy-team-fallback",
  "resource-grant",
]);
export type AuthzGrantVia = z.infer<typeof authzGrantViaSchema>;

export const authzDecisionSchema = z
  .object({
    allowed: z.boolean(),
    // Kept as string for exact compatibility with decisions over legacy rows.
    permission: z.string(),
    scope: authzScopeRefSchema,
    principal: authzPrincipalRefSchema,
    via: authzGrantViaSchema.optional(),
    matchedBinding: collectedBindingSchema.optional(),
    denialReason: authzDenialReasonSchema.optional(),
    audience: z.enum(["member", "public"]),
  })
  .strict();
export type AuthzDecision = z.infer<typeof authzDecisionSchema>;

/**
 * Branded proof that the service allowed one permission at one binding tier.
 * The brand is module-private and the package exports no factory. Only the
 * concrete AuthzService implementation may construct this after authorization.
 */
declare const AUTHORIZED_BRAND: unique symbol;
export type Authorized<
  Tier extends z.infer<typeof bindingScopeTierSchema> = z.infer<
    typeof bindingScopeTierSchema
  >,
  Permission extends z.infer<typeof authzPermissionSchema> = z.infer<
    typeof authzPermissionSchema
  >,
> = {
  readonly [AUTHORIZED_BRAND]: true;
  readonly permission: Permission;
  readonly scope: { readonly tier: Tier; readonly id: string };
};
