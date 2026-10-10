import {
  authzDenialReasonSchema,
  type AuthzPermission,
  type DeclaredScopeTier,
  organizationRoleSchema,
  shareableResourceKindSchema,
} from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { PROJECT_READER_ROLE_KEY } from "./roles.ts";

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
    /** `Project.kind` (ADR-177), when the scope was read from the project. */
    kind: z.string().optional(),
  })
  .strict();

const teamScopeRefSchema = z
  .object({
    type: z.literal("team"),
    id: z.string(),
    organizationId: z.string(),
    isPersonal: z.boolean().optional(),
    name: z.string().optional(),
  })
  .strict();

const organizationScopeRefSchema = z
  .object({ type: z.literal("organization"), id: z.string() })
  .strict();

const grantableAuthzScopeRefSchemaDefinition = z.discriminatedUnion("type", [
  projectScopeRefSchema,
  teamScopeRefSchema,
  organizationScopeRefSchema,
]);
export interface GrantableAuthzScopeRefSchema extends Named<
  typeof grantableAuthzScopeRefSchemaDefinition
> {}
export const grantableAuthzScopeRefSchema: GrantableAuthzScopeRefSchema =
  grantableAuthzScopeRefSchemaDefinition;
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

const authzScopeRefSchemaDefinition = z.discriminatedUnion("type", [
  projectScopeRefSchema,
  teamScopeRefSchema,
  organizationScopeRefSchema,
  resourceScopeRefSchema,
]);
export interface AuthzScopeRefSchema extends Named<typeof authzScopeRefSchemaDefinition> {}
export const authzScopeRefSchema: AuthzScopeRefSchema = authzScopeRefSchemaDefinition;
export type AuthzScopeRef = z.infer<typeof authzScopeRefSchema>;

/** The tenant and scope id every PLATFORM-tier grant is stored under; never a KSUID org id. */
export const PLATFORM_TENANT_ID = "platform" as const;

/** The installation itself: asked only of `can`, answered only from PLATFORM-tier grants. */
const platformScopeRefSchemaDefinition = z.object({ type: z.literal("platform") }).strict();
export interface PlatformScopeRefSchema extends Named<typeof platformScopeRefSchemaDefinition> {}
export const platformScopeRefSchema: PlatformScopeRefSchema = platformScopeRefSchemaDefinition;
export type PlatformScopeRef = z.infer<typeof platformScopeRefSchema>;

/** Where `can` may be asked: every organization-rooted scope, or the platform. */
const authzCanScopeRefSchemaDefinition = z.discriminatedUnion("type", [
  projectScopeRefSchema,
  teamScopeRefSchema,
  organizationScopeRefSchema,
  resourceScopeRefSchema,
  platformScopeRefSchema,
]);
export interface AuthzCanScopeRefSchema extends Named<typeof authzCanScopeRefSchemaDefinition> {}
export const authzCanScopeRefSchema: AuthzCanScopeRefSchema = authzCanScopeRefSchemaDefinition;
export type AuthzCanScopeRef = z.infer<typeof authzCanScopeRefSchema>;

const authzPrincipalRefSchemaDefinition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), id: z.string() }).strict(),
  z.object({ type: z.literal("apiKey"), id: z.string() }).strict(),
  z.object({ type: z.literal("anonymous") }).strict(),
]);
export interface AuthzPrincipalRefSchema extends Named<typeof authzPrincipalRefSchemaDefinition> {}
export const authzPrincipalRefSchema: AuthzPrincipalRefSchema = authzPrincipalRefSchemaDefinition;
export type AuthzPrincipalRef = z.infer<typeof authzPrincipalRefSchema>;

const grantAudienceSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: z.string() }).strict(),
  z.object({ kind: z.literal("apiKey"), id: z.string() }).strict(),
  z.object({ kind: z.literal("group"), id: z.string() }).strict(),
  z.object({ kind: z.literal("team"), id: z.string() }).strict(),
  z.object({ kind: z.literal("project"), id: z.string() }).strict(),
  z.object({ kind: z.literal("organization"), id: z.string() }).strict(),
  z.object({ kind: z.literal("anyone") }).strict(),
]);
export interface GrantAudienceSchema extends Named<typeof grantAudienceSchemaDefinition> {}
export const grantAudienceSchema: GrantAudienceSchema = grantAudienceSchemaDefinition;
export type GrantAudience = z.infer<typeof grantAudienceSchema>;

const resourceGrantSchemaDefinition = z
  .object({
    kind: shareableResourceKindSchema,
    id: z.string(),
    projectId: z.string(),
    // Legacy rows may carry unknown strings. New write schemas are stricter.
    permission: z.string(),
    audience: grantAudienceSchema,
  })
  .strict();
export interface ResourceGrantSchema extends Named<typeof resourceGrantSchemaDefinition> {}
export const resourceGrantSchema: ResourceGrantSchema = resourceGrantSchemaDefinition;
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

/** ADR-177: the role a SHARED grant carries, one project reading another; never a legacy
 *  binding role. */
export type SharedRoleKey = typeof PROJECT_READER_ROLE_KEY;
const sharedRoleKeySchema = z.custom<SharedRoleKey>((value) => value === PROJECT_READER_ROLE_KEY);

const collectedBindingSchemaDefinition = z
  .object({
    roleKey: bindingRoleKeySchema.or(sharedRoleKeySchema),
    scopeType: grantScopeTierSchema,
    scopeId: z.string(),
    viaGroupId: z.string().nullable().optional(),
    /** Reported, never filtered, by the reader: whether an elapsed one still grants is
     *  the collector's call. */
    expiresAtMs: z.number().int().nullable().optional(),
  })
  .strict();
export interface CollectedBindingSchema extends Named<typeof collectedBindingSchemaDefinition> {}
export const collectedBindingSchema: CollectedBindingSchema = collectedBindingSchemaDefinition;
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

const collectedGrantsSchemaDefinition = z
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
export interface CollectedGrantsSchema extends Named<typeof collectedGrantsSchemaDefinition> {}
export const collectedGrantsSchema: CollectedGrantsSchema = collectedGrantsSchemaDefinition;
export type CollectedGrants = z.infer<typeof collectedGrantsSchema>;

export const authzGrantViaSchema = z.enum([
  "binding",
  "org-role-floor",
  "demo-project",
  "resource-grant",
]);
export type AuthzGrantVia = z.infer<typeof authzGrantViaSchema>;

const authzDecisionSchemaDefinition = z
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
export interface AuthzDecisionSchema extends Named<typeof authzDecisionSchemaDefinition> {}
export const authzDecisionSchema: AuthzDecisionSchema = authzDecisionSchemaDefinition;
export type AuthzDecision = z.infer<typeof authzDecisionSchema>;

/**
 * Branded proof that the service allowed one permission at one binding tier.
 * The brand is module-private and the package exports no factory. Only the
 * authz process's AuthzService may construct this after authorization.
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
