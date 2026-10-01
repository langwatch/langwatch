import {
  authzDenialReasonSchema,
  type AuthzPermission,
  type DeclaredScopeTier,
  organizationRoleSchema,
  shareableResourceKindSchema,
} from "@langwatch/authorization";
import { z } from "zod";

/** Portable AuthZ vocabulary. Persisted and transport values validate here. */
export const teamUserRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
export type TeamUserRole = z.infer<typeof teamUserRoleSchema>;
/** The same members as values, for code that names one rather than parses it. */
export const TeamUserRole = teamUserRoleSchema.enum;

export const grantScopeTierSchema = z.enum(["PROJECT", "TEAM", "ORGANIZATION"]);
export type GrantScopeTier = z.infer<typeof grantScopeTierSchema>;
export const GrantScopeTier = grantScopeTierSchema.enum;

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

/** The tenant and scope id every PLATFORM-tier grant is stored under; never a KSUID org id. */
export const PLATFORM_TENANT_ID = "platform" as const;

/** The installation itself: asked only of `can`, answered only from PLATFORM-tier grants. */
export const platformScopeRefSchema = z.object({ type: z.literal("platform") }).strict();
export type PlatformScopeRef = z.infer<typeof platformScopeRefSchema>;

/** Where `can` may be asked: every organization-rooted scope, or the platform. */
export const authzCanScopeRefSchema = z.discriminatedUnion("type", [
  projectScopeRefSchema,
  teamScopeRefSchema,
  organizationScopeRefSchema,
  resourceScopeRefSchema,
  platformScopeRefSchema,
]);
export type AuthzCanScopeRef = z.infer<typeof authzCanScopeRefSchema>;

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

/** Role keys currently enforced by organization, team and project grants. */
export type BindingRoleKey = "admin" | "member" | "viewer" | `custom:${string}`;

/** A template-literal union no Zod primitive expresses, so it is checked. */
export const bindingRoleKeySchema = z.custom<BindingRoleKey>(
  (value) =>
    value === "admin" ||
    value === "member" ||
    value === "viewer" ||
    (typeof value === "string" && value.startsWith("custom:") && value.length > "custom:".length),
);

export const collectedBindingSchema = z
  .object({
    roleKey: bindingRoleKeySchema,
    scopeType: grantScopeTierSchema,
    scopeId: z.string(),
    viaGroupId: z.string().nullable().optional(),
    /** Reported, never filtered, by the reader: whether an elapsed one still grants is
     *  the collector's call. */
    expiresAtMs: z.number().int().nullable().optional(),
  })
  .strict();
export type CollectedBinding = z.infer<typeof collectedBindingSchema>;

/** The one place a stored `(role, customRoleId)` pair becomes a role key. */
export function bindingRoleKeyOf({
  role,
  customRoleId,
}: {
  role: TeamUserRole;
  customRoleId: string | null;
}): BindingRoleKey {
  if (customRoleId !== null && customRoleId.length > 0) return `custom:${customRoleId}`;
  if (role === "ADMIN") return "admin";
  if (role === "MEMBER") return "member";
  return "viewer";
}

const customRolePermissionsSchema = z
  .map(z.string(), z.array(z.string()).readonly())
  .transform((permissions): ReadonlyMap<string, readonly string[]> => permissions);

export const collectedGrantsSchema = z
  .object({
    principal: authzPrincipalRefSchema,
    organizationId: z.string(),
    organizationRole: organizationRoleSchema.nullable(),
    isOrgMember: z.boolean(),
    membershipDisabled: z.boolean().default(false),
    bindings: z.array(collectedBindingSchema),
    customRolePermissions: customRolePermissionsSchema,
  })
  .strict();
export type CollectedGrants = z.infer<typeof collectedGrantsSchema>;

export const authzGrantViaSchema = z.enum([
  "binding",
  "org-role-floor",
  "demo-project",
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
  Tier extends DeclaredScopeTier = DeclaredScopeTier,
  Permission extends AuthzPermission = AuthzPermission,
> = {
  readonly [AUTHORIZED_BRAND]: true;
  readonly permission: Permission;
  readonly scope: { readonly tier: Tier; readonly id: string };
};
