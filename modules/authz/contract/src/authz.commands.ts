import { actorSchema, grantConditionSchema, ledgerActorSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  grantEventSourceSchema,
  grantShapeRefinement,
  ledgerPrincipalSchema,
  ledgerScopeSchema,
  legacyBindingRoleSchema,
  resourceGrantTermsSchema,
} from "./authz-grant.events.ts";
import {
  authzPrincipalRefSchema,
  grantableAuthzScopeRefSchema,
  grantScopeTierSchema,
  teamUserRoleSchema,
} from "./authz.ts";

export const ATTACH_GRANT_COMMAND_TYPE = "lw.authz_grant.attach" as const;
export const CHANGE_GRANT_ROLE_COMMAND_TYPE = "lw.authz_grant.change_role" as const;
export const REVOKE_GRANT_COMMAND_TYPE = "lw.authz_grant.revoke" as const;
export const DEFINE_ROLE_COMMAND_TYPE = "lw.authz_role.define" as const;
export const CHANGE_ROLE_PERMISSIONS_COMMAND_TYPE = "lw.authz_role.change_permissions" as const;
export const DELETE_ROLE_COMMAND_TYPE = "lw.authz_role.delete" as const;

export const authzRoleKindSchema = z.enum(["custom", "system_api_key"]);
export type AuthzRoleKind = z.infer<typeof authzRoleKindSchema>;

export const AUTHZ_GRANT_COMMAND_TYPES = [
  ATTACH_GRANT_COMMAND_TYPE,
  CHANGE_GRANT_ROLE_COMMAND_TYPE,
  REVOKE_GRANT_COMMAND_TYPE,
] as const;
export const AUTHZ_ROLE_COMMAND_TYPES = [
  DEFINE_ROLE_COMMAND_TYPE,
  CHANGE_ROLE_PERMISSIONS_COMMAND_TYPE,
  DELETE_ROLE_COMMAND_TYPE,
] as const;
export const AUTHZ_GRANTS_COMMAND_TYPES = [
  ...AUTHZ_GRANT_COMMAND_TYPES,
  ...AUTHZ_ROLE_COMMAND_TYPES,
] as const;

const commandIdentitySchema = z
  .object({
    tenantId: z.string().min(1),
    organizationId: z.string().min(1),
    commandId: z.string().min(1),
  })
  .strict();

type CommandIdentity = z.infer<typeof commandIdentitySchema>;

/** One grants ledger per organization: every command names its tenant twice. */
const isOneLedgerPerOrganization = (data: CommandIdentity): boolean =>
  data.tenantId === data.organizationId;
const ONE_LEDGER_PER_ORGANIZATION = {
  message: "tenantId must equal organizationId: one grants ledger per organization",
  path: ["tenantId"],
};

const attachGrantEntrySchemaDefinition = z
  .object({
    grantId: z.string().min(1),
    principal: ledgerPrincipalSchema,
    roleKey: z.string().min(1).nullable(),
    scope: ledgerScopeSchema,
    resource: resourceGrantTermsSchema.optional(),
    /** Present only on a shared project-reader grant (ADR-177). */
    condition: grantConditionSchema.optional(),
    legacyRole: legacyBindingRoleSchema.optional(),
    expiresAtMs: z.number().int().positive().optional(),
    source: grantEventSourceSchema,
    actor: ledgerActorSchema,
    occurredAtMs: z.number().int().nonnegative(),
    /** Current membership lifetime for a USER grant. Imported history omits
     *  this field so replay keeps its pre-fence behavior. */
    membershipStamp: z.string().min(1).optional(),
    /** Only founder creation may use this while its transaction is open. */
    membershipBootstrap: z.boolean().optional(),
    /** The writer asked to skip an identical live grant; the fold honours it too. */
    onDuplicate: z.literal("skip").optional(),
  })
  .strict()
  .refine(grantShapeRefinement.check, {
    message: grantShapeRefinement.message,
    path: [...grantShapeRefinement.path],
  })
  .refine((grant) => !grant.membershipBootstrap || grant.membershipStamp, {
    message: "membershipBootstrap requires membershipStamp",
    path: ["membershipStamp"],
  })
  .refine(
    (grant) =>
      !grant.membershipBootstrap ||
      (grant.principal.type === "user" &&
        grant.roleKey === "admin" &&
        (grant.scope.type === "TEAM" || grant.scope.type === "ORGANIZATION")),
    {
      message:
        "membershipBootstrap is only valid for stamped USER ADMIN organization/team bindings",
      path: ["membershipBootstrap"],
    },
  );
export interface AttachGrantEntrySchema extends Named<typeof attachGrantEntrySchemaDefinition> {}
export const attachGrantEntrySchema: AttachGrantEntrySchema = attachGrantEntrySchemaDefinition;
export type AttachGrantEntry = z.infer<typeof attachGrantEntrySchema>;

const attachGrantCommandDataSchemaDefinition = commandIdentitySchema
  .safeExtend({
    grant: attachGrantEntrySchema,
  })
  .refine(isOneLedgerPerOrganization, ONE_LEDGER_PER_ORGANIZATION)
  .refine(
    (data) =>
      !data.grant.membershipBootstrap ||
      data.grant.scope.type !== "ORGANIZATION" ||
      data.grant.scope.id === data.organizationId,
    {
      message: "organization bootstrap must target its tenant organization",
      path: ["grant", "scope", "id"],
    },
  );
export interface AttachGrantCommandDataSchema extends Named<
  typeof attachGrantCommandDataSchemaDefinition
> {}
export const attachGrantCommandDataSchema: AttachGrantCommandDataSchema =
  attachGrantCommandDataSchemaDefinition;
export type AttachGrantCommandData = z.infer<typeof attachGrantCommandDataSchema>;

const changeGrantRoleCommandDataSchemaDefinition = commandIdentitySchema
  .safeExtend({
    grantId: z.string().min(1),
    from: z.string().min(1).nullable(),
    to: z.string().min(1),
    actor: ledgerActorSchema,
    occurredAtMs: z.number().int().nonnegative(),
  })
  .refine(isOneLedgerPerOrganization, ONE_LEDGER_PER_ORGANIZATION);
export interface ChangeGrantRoleCommandDataSchema extends Named<
  typeof changeGrantRoleCommandDataSchemaDefinition
> {}
export const changeGrantRoleCommandDataSchema: ChangeGrantRoleCommandDataSchema =
  changeGrantRoleCommandDataSchemaDefinition;
export type ChangeGrantRoleCommandData = z.infer<typeof changeGrantRoleCommandDataSchema>;

const revokeGrantCommandDataSchemaDefinition = commandIdentitySchema
  .safeExtend({
    grantId: z.string().min(1),
    reason: z.string().min(1).optional(),
    actor: ledgerActorSchema,
    occurredAtMs: z.number().int().nonnegative(),
  })
  .refine(isOneLedgerPerOrganization, ONE_LEDGER_PER_ORGANIZATION);
export interface RevokeGrantCommandDataSchema extends Named<
  typeof revokeGrantCommandDataSchemaDefinition
> {}
export const revokeGrantCommandDataSchema: RevokeGrantCommandDataSchema =
  revokeGrantCommandDataSchemaDefinition;
export type RevokeGrantCommandData = z.infer<typeof revokeGrantCommandDataSchema>;

const defineRoleEntrySchemaDefinition = z
  .object({
    roleId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string().min(1)),
    kind: authzRoleKindSchema,
    occurredAtMs: z.number().int().nonnegative(),
  })
  .strict();
export interface DefineRoleEntrySchema extends Named<typeof defineRoleEntrySchemaDefinition> {}
export const defineRoleEntrySchema: DefineRoleEntrySchema = defineRoleEntrySchemaDefinition;
export type DefineRoleEntry = z.infer<typeof defineRoleEntrySchema>;

const defineRoleCommandDataSchemaDefinition = commandIdentitySchema
  .safeExtend({
    role: defineRoleEntrySchema,
    actor: ledgerActorSchema,
  })
  .refine(isOneLedgerPerOrganization, ONE_LEDGER_PER_ORGANIZATION);
export interface DefineRoleCommandDataSchema extends Named<
  typeof defineRoleCommandDataSchemaDefinition
> {}
export const defineRoleCommandDataSchema: DefineRoleCommandDataSchema =
  defineRoleCommandDataSchemaDefinition;
export type DefineRoleCommandData = z.infer<typeof defineRoleCommandDataSchema>;

const changeRolePermissionsCommandDataSchemaDefinition = commandIdentitySchema
  .safeExtend({
    roleId: z.string().min(1),
    permissions: z.array(z.string().min(1)),
    actor: ledgerActorSchema,
    occurredAtMs: z.number().int().nonnegative(),
  })
  .refine(isOneLedgerPerOrganization, ONE_LEDGER_PER_ORGANIZATION);
export interface ChangeRolePermissionsCommandDataSchema extends Named<
  typeof changeRolePermissionsCommandDataSchemaDefinition
> {}
export const changeRolePermissionsCommandDataSchema: ChangeRolePermissionsCommandDataSchema =
  changeRolePermissionsCommandDataSchemaDefinition;
export type ChangeRolePermissionsCommandData = z.infer<
  typeof changeRolePermissionsCommandDataSchema
>;

const deleteRoleCommandDataSchemaDefinition = commandIdentitySchema
  .safeExtend({
    roleId: z.string().min(1),
    actor: ledgerActorSchema,
    occurredAtMs: z.number().int().nonnegative(),
  })
  .refine(isOneLedgerPerOrganization, ONE_LEDGER_PER_ORGANIZATION);
export interface DeleteRoleCommandDataSchema extends Named<
  typeof deleteRoleCommandDataSchemaDefinition
> {}
export const deleteRoleCommandDataSchema: DeleteRoleCommandDataSchema =
  deleteRoleCommandDataSchemaDefinition;
export type DeleteRoleCommandData = z.infer<typeof deleteRoleCommandDataSchema>;

/**
 * Full GRANT_EVENT_SOURCES (not a subset) to prevent silently stranding
 * auditable sources like join-request.
 */
export const authzLedgerWriteSourceSchema = grantEventSourceSchema;
export type AuthzLedgerWriteSource = z.infer<typeof authzLedgerWriteSourceSchema>;

const authzLedgerBindingPrincipalSchemaDefinition = z.union([
  z.object({ userId: z.string().min(1) }).strict(),
  z.object({ groupId: z.string().min(1) }).strict(),
  z.object({ apiKeyId: z.string().min(1) }).strict(),
]);
export interface AuthzLedgerBindingPrincipalSchema extends Named<
  typeof authzLedgerBindingPrincipalSchemaDefinition
> {}
export const authzLedgerBindingPrincipalSchema: AuthzLedgerBindingPrincipalSchema =
  authzLedgerBindingPrincipalSchemaDefinition;
export type AuthzLedgerBindingPrincipal = z.infer<typeof authzLedgerBindingPrincipalSchema>;

const authzLedgerBindingAttachSchemaDefinition = z
  .object({
    bindingId: z.string().min(1),
    principal: authzLedgerBindingPrincipalSchema,
    role: teamUserRoleSchema,
    customRoleId: z.string().min(1).nullable(),
    scopeType: grantScopeTierSchema,
    scopeId: z.string().min(1),
    /** When the binding stops granting; the writing service refuses a moment already passed. */
    expiresAtMs: z.number().int().optional(),
    /** Founder creation only: the membership generation, read in the transaction that made it. */
    membershipStamp: z.string().min(1).optional(),
    /** Founder-only: lets the grant land while its membership is still held disabled. */
    membershipBootstrap: z.boolean().optional(),
  })
  .strict();
export interface AuthzLedgerBindingAttachSchema extends Named<
  typeof authzLedgerBindingAttachSchemaDefinition
> {}
export const authzLedgerBindingAttachSchema: AuthzLedgerBindingAttachSchema =
  authzLedgerBindingAttachSchemaDefinition;
export type AuthzLedgerBindingAttach = z.infer<typeof authzLedgerBindingAttachSchema>;

function ledgerPrincipalId(principal: AuthzLedgerBindingPrincipal): string {
  if ("userId" in principal) return principal.userId;
  if ("groupId" in principal) return principal.groupId;
  return principal.apiKeyId;
}

/** Stable identity shared by compatibility reconcilers and the server ledger. */
export function authzBindingIdentityKey({
  principal,
  scopeType,
  scopeId,
  role,
  customRoleId,
}: {
  principal: AuthzLedgerBindingPrincipal;
  scopeType: string;
  scopeId: string;
  role: string;
  customRoleId: string | null;
}): string {
  const principalId = ledgerPrincipalId(principal);
  const roleIdentity = customRoleId === null ? `builtin:${role}` : `custom:${customRoleId}`;
  return [principalId, scopeType, scopeId, roleIdentity].join("\u001f");
}

const authzAttachOutcomeSchemaDefinition = z
  .object({
    attached: z.array(z.string().min(1)),
    duplicates: z.array(z.string().min(1)),
  })
  .strict();
export interface AuthzAttachOutcomeSchema extends Named<
  typeof authzAttachOutcomeSchemaDefinition
> {}
export const authzAttachOutcomeSchema: AuthzAttachOutcomeSchema =
  authzAttachOutcomeSchemaDefinition;
export type AuthzAttachOutcome = z.infer<typeof authzAttachOutcomeSchema>;

/**
 * Whose holdings bound a grant write: a person or key is refused anything beyond what it holds
 * there; `system` is a consequence of an already-authorized act (an accepted invite, SCIM,
 * sign-up).
 */
const authzGrantCallerSchemaDefinition = z.union([
  authzPrincipalRefSchema,
  z.object({ type: z.literal("system") }).strict(),
]);
export interface AuthzGrantCallerSchema extends Named<typeof authzGrantCallerSchemaDefinition> {}
export const authzGrantCallerSchema: AuthzGrantCallerSchema = authzGrantCallerSchemaDefinition;
export type AuthzGrantCaller = z.infer<typeof authzGrantCallerSchema>;

const authzAttachBindingsInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    bindings: z.array(authzLedgerBindingAttachSchema),
    caller: authzGrantCallerSchema,
    actor: ledgerActorSchema,
    source: authzLedgerWriteSourceSchema.optional(),
    /** `attach` writes every binding, identical ones included (bindings are
     *  never unique); `skip` leaves out one the principal already holds. */
    onDuplicate: z.enum(["attach", "skip"]),
    commandId: z.string().min(1).optional(),
    occurredAtMs: z.number().int().nonnegative().optional(),
    awaitProjection: z.boolean().optional(),
    /**
     * Whether an unlanded projection is an error rather than a pass. Only a
     * caller about to hand out access these rows decide asks for it.
     */
    requireProjection: z.boolean().optional(),
  })
  .strict();
export interface AuthzAttachBindingsInputSchema extends Named<
  typeof authzAttachBindingsInputSchemaDefinition
> {}
export const authzAttachBindingsInputSchema: AuthzAttachBindingsInputSchema =
  authzAttachBindingsInputSchemaDefinition;
export type AuthzAttachBindingsInput = z.infer<typeof authzAttachBindingsInputSchema>;
export const authzAttachBindingsOutputSchema = authzAttachOutcomeSchema;
export type AuthzAttachBindingsOutput = AuthzAttachOutcome;

const authzLedgerResourcePrincipalSchemaDefinition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("anyone"), id: z.null() }).strict(),
  z.object({ type: z.literal("organization"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("project"), id: z.string().min(1) }).strict(),
]);
export interface AuthzLedgerResourcePrincipalSchema extends Named<
  typeof authzLedgerResourcePrincipalSchemaDefinition
> {}
export const authzLedgerResourcePrincipalSchema: AuthzLedgerResourcePrincipalSchema =
  authzLedgerResourcePrincipalSchemaDefinition;
export type AuthzLedgerResourcePrincipal = z.infer<typeof authzLedgerResourcePrincipalSchema>;

export const AUTHZ_SHARE_PERMISSION = "traces:view" as const;

export function authzShareAudience({
  visibility,
  organizationId,
  projectId,
}: {
  visibility: "PUBLIC" | "ORGANIZATION" | "PROJECT";
  organizationId: string;
  projectId: string;
}): AuthzLedgerResourcePrincipal {
  switch (visibility) {
    case "PUBLIC":
      return { type: "anyone", id: null };
    case "ORGANIZATION":
      return { type: "organization", id: organizationId };
    case "PROJECT":
      return { type: "project", id: projectId };
  }
}

const authzLedgerResourceTermsSchemaDefinition = z
  .object({
    token: z.string().min(1),
    permission: z.string().min(1),
    kind: z.enum(["trace", "thread"]),
    expiresAtMs: z.number().int().nonnegative().optional(),
    maxViews: z.number().int().nonnegative().optional(),
    createdByUserId: z.string().min(1).optional(),
  })
  .strict();
export interface AuthzLedgerResourceTermsSchema extends Named<
  typeof authzLedgerResourceTermsSchemaDefinition
> {}
export const authzLedgerResourceTermsSchema: AuthzLedgerResourceTermsSchema =
  authzLedgerResourceTermsSchemaDefinition;
export type AuthzLedgerResourceTerms = z.infer<typeof authzLedgerResourceTermsSchema>;

const authzAttachResourceGrantInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    grantId: z.string().min(1),
    projectId: z.string().min(1),
    resource: authzLedgerResourceTermsSchema,
    principal: authzLedgerResourcePrincipalSchema,
    scopeId: z.string().min(1),
    actor: ledgerActorSchema,
    commandId: z.string().min(1).optional(),
  })
  .strict();
export interface AuthzAttachResourceGrantInputSchema extends Named<
  typeof authzAttachResourceGrantInputSchemaDefinition
> {}
export const authzAttachResourceGrantInputSchema: AuthzAttachResourceGrantInputSchema =
  authzAttachResourceGrantInputSchemaDefinition;
export type AuthzAttachResourceGrantInput = z.infer<typeof authzAttachResourceGrantInputSchema>;
export const authzAttachResourceGrantOutputSchema = z.void();
export type AuthzAttachResourceGrantOutput = z.infer<typeof authzAttachResourceGrantOutputSchema>;

const authzRevokeResourceGrantsInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    grantIds: z.array(z.string().min(1)),
    actor: ledgerActorSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();
export interface AuthzRevokeResourceGrantsInputSchema extends Named<
  typeof authzRevokeResourceGrantsInputSchemaDefinition
> {}
export const authzRevokeResourceGrantsInputSchema: AuthzRevokeResourceGrantsInputSchema =
  authzRevokeResourceGrantsInputSchemaDefinition;
export type AuthzRevokeResourceGrantsInput = z.infer<typeof authzRevokeResourceGrantsInputSchema>;
export const authzRevokeResourceGrantsOutputSchema = z.void();
export type AuthzRevokeResourceGrantsOutput = z.infer<typeof authzRevokeResourceGrantsOutputSchema>;

/** One reader project's live shared reads (ADR-177), one per member project. */
const authzFindLiveSharedProjectGrantsInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1), readerProjectId: z.string().min(1) })
  .strict();
export interface AuthzFindLiveSharedProjectGrantsInputSchema extends Named<
  typeof authzFindLiveSharedProjectGrantsInputSchemaDefinition
> {}
export const authzFindLiveSharedProjectGrantsInputSchema: AuthzFindLiveSharedProjectGrantsInputSchema =
  authzFindLiveSharedProjectGrantsInputSchemaDefinition;
export type AuthzFindLiveSharedProjectGrantsInput = z.infer<
  typeof authzFindLiveSharedProjectGrantsInputSchema
>;
const authzSharedProjectGrantSchemaDefinition = z.object({
  grantId: z.string().min(1),
  memberProjectId: z.string().min(1),
});
export interface AuthzSharedProjectGrantSchema extends Named<
  typeof authzSharedProjectGrantSchemaDefinition
> {}
export const authzSharedProjectGrantSchema: AuthzSharedProjectGrantSchema =
  authzSharedProjectGrantSchemaDefinition;
export type AuthzSharedProjectGrant = z.infer<typeof authzSharedProjectGrantSchema>;

const authzAttachSharedProjectGrantInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    readerProjectId: z.string().min(1),
    memberProjectId: z.string().min(1),
    condition: grantConditionSchema,
    actor: ledgerActorSchema,
    source: grantEventSourceSchema.optional(),
    commandId: z.string().min(1).optional(),
    awaitProjection: z.boolean().optional(),
  })
  .strict();
export interface AuthzAttachSharedProjectGrantInputSchema extends Named<
  typeof authzAttachSharedProjectGrantInputSchemaDefinition
> {}
export const authzAttachSharedProjectGrantInputSchema: AuthzAttachSharedProjectGrantInputSchema =
  authzAttachSharedProjectGrantInputSchemaDefinition;
export type AuthzAttachSharedProjectGrantInput = z.infer<
  typeof authzAttachSharedProjectGrantInputSchema
>;
const authzAttachSharedProjectGrantOutputSchemaDefinition = z.object({
  grantId: z.string().min(1),
  wasAttached: z.boolean(),
});
export interface AuthzAttachSharedProjectGrantOutputSchema extends Named<
  typeof authzAttachSharedProjectGrantOutputSchemaDefinition
> {}
export const authzAttachSharedProjectGrantOutputSchema: AuthzAttachSharedProjectGrantOutputSchema =
  authzAttachSharedProjectGrantOutputSchemaDefinition;
export type AuthzAttachSharedProjectGrantOutput = z.infer<
  typeof authzAttachSharedProjectGrantOutputSchema
>;

const authzAwaitSharedProjectGrantsInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1), grantIds: z.array(z.string().min(1)) })
  .strict();
export interface AuthzAwaitSharedProjectGrantsInputSchema extends Named<
  typeof authzAwaitSharedProjectGrantsInputSchemaDefinition
> {}
export const authzAwaitSharedProjectGrantsInputSchema: AuthzAwaitSharedProjectGrantsInputSchema =
  authzAwaitSharedProjectGrantsInputSchemaDefinition;
export type AuthzAwaitSharedProjectGrantsInput = z.infer<
  typeof authzAwaitSharedProjectGrantsInputSchema
>;

const authzRevokeSharedProjectGrantsInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    readerProjectId: z.string().min(1),
    memberProjectIds: z.array(z.string().min(1)).optional(),
    actor: ledgerActorSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();
export interface AuthzRevokeSharedProjectGrantsInputSchema extends Named<
  typeof authzRevokeSharedProjectGrantsInputSchemaDefinition
> {}
export const authzRevokeSharedProjectGrantsInputSchema: AuthzRevokeSharedProjectGrantsInputSchema =
  authzRevokeSharedProjectGrantsInputSchemaDefinition;
export type AuthzRevokeSharedProjectGrantsInput = z.infer<
  typeof authzRevokeSharedProjectGrantsInputSchema
>;

const authzChangeBindingRoleInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    bindingId: z.string().min(1),
    role: teamUserRoleSchema,
    customRoleId: z.string().min(1).nullable(),
    caller: authzGrantCallerSchema,
    actor: ledgerActorSchema,
  })
  .strict();
export interface AuthzChangeBindingRoleInputSchema extends Named<
  typeof authzChangeBindingRoleInputSchemaDefinition
> {}
export const authzChangeBindingRoleInputSchema: AuthzChangeBindingRoleInputSchema =
  authzChangeBindingRoleInputSchemaDefinition;
export type AuthzChangeBindingRoleInput = z.infer<typeof authzChangeBindingRoleInputSchema>;
export const authzChangeBindingRoleOutputSchema = z.void();
export type AuthzChangeBindingRoleOutput = z.infer<typeof authzChangeBindingRoleOutputSchema>;

const authzRevokeBindingsInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    bindingIds: z.array(z.string().min(1)),
    actor: ledgerActorSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();
export interface AuthzRevokeBindingsInputSchema extends Named<
  typeof authzRevokeBindingsInputSchemaDefinition
> {}
export const authzRevokeBindingsInputSchema: AuthzRevokeBindingsInputSchema =
  authzRevokeBindingsInputSchemaDefinition;
export type AuthzRevokeBindingsInput = z.infer<typeof authzRevokeBindingsInputSchema>;
export const authzRevokeBindingsOutputSchema = z.void();
export type AuthzRevokeBindingsOutput = z.infer<typeof authzRevokeBindingsOutputSchema>;

/**
 * Retires the grants the DIRECTORY itself wrote at the organization scope for
 * these people; group membership supplies their access now. An
 * administrator's own grant at the same scope carries another source.
 */
const authzRetireDirectoryGrantsInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    userIds: z.array(z.string().min(1)),
    actor: ledgerActorSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();
export interface AuthzRetireDirectoryGrantsInputSchema extends Named<
  typeof authzRetireDirectoryGrantsInputSchemaDefinition
> {}
export const authzRetireDirectoryGrantsInputSchema: AuthzRetireDirectoryGrantsInputSchema =
  authzRetireDirectoryGrantsInputSchemaDefinition;
export type AuthzRetireDirectoryGrantsInput = z.infer<typeof authzRetireDirectoryGrantsInputSchema>;
/** How many grants were retired. */
export const authzRetireDirectoryGrantsOutputSchema = z.number().int().nonnegative();
export type AuthzRetireDirectoryGrantsOutput = z.infer<
  typeof authzRetireDirectoryGrantsOutputSchema
>;

/**
 * What the directory has changed lately, for the reconciliation panel: the
 * grants it wrote and the ones it took back, newest first. A read, asked of
 * the module that owns grants because nobody else queries them.
 */
const authzDirectoryCausedChangesInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    limit: z.number().int().positive(),
  })
  .strict();
export interface AuthzDirectoryCausedChangesInputSchema extends Named<
  typeof authzDirectoryCausedChangesInputSchemaDefinition
> {}
export const authzDirectoryCausedChangesInputSchema: AuthzDirectoryCausedChangesInputSchema =
  authzDirectoryCausedChangesInputSchemaDefinition;
export type AuthzDirectoryCausedChangesInput = z.infer<
  typeof authzDirectoryCausedChangesInputSchema
>;

const authzDirectoryCausedChangeSchemaDefinition = z
  .object({
    grantId: z.string().min(1),
    /** Null where the grant names a principal that is not a person. */
    userId: z.string().min(1).nullable(),
    kind: z.enum(["attached", "removed"]),
    occurredAtMs: z.number().int().nonnegative(),
  })
  .strict();
export interface AuthzDirectoryCausedChangeSchema extends Named<
  typeof authzDirectoryCausedChangeSchemaDefinition
> {}
export const authzDirectoryCausedChangeSchema: AuthzDirectoryCausedChangeSchema =
  authzDirectoryCausedChangeSchemaDefinition;
export type AuthzDirectoryCausedChange = z.infer<typeof authzDirectoryCausedChangeSchema>;
const authzDirectoryCausedChangesOutputSchemaDefinition = z.array(authzDirectoryCausedChangeSchema);
export interface AuthzDirectoryCausedChangesOutputSchema extends Named<
  typeof authzDirectoryCausedChangesOutputSchemaDefinition
> {}
export const authzDirectoryCausedChangesOutputSchema: AuthzDirectoryCausedChangesOutputSchema =
  authzDirectoryCausedChangesOutputSchemaDefinition;
export type AuthzDirectoryCausedChangesOutput = z.infer<
  typeof authzDirectoryCausedChangesOutputSchema
>;

const authzStringSetFilterSchema = z.object({ in: z.array(z.string().min(1)) }).strict();
const authzBindingIdFilterSchema = z
  .object({
    in: z.array(z.string().min(1)).optional(),
    not: z.string().min(1).optional(),
    notIn: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** A closed, transport-safe selector. Tenant scope is intentionally absent:
 * organizationId is a required top-level field and always wins. */
const authzBindingFilterSchemaDefinition = z
  .object({
    userId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    apiKeyId: z.string().min(1).optional(),
    customRoleId: z.union([z.string().min(1), authzStringSetFilterSchema]).optional(),
    scopeType: grantScopeTierSchema.optional(),
    scopeId: z.string().min(1).optional(),
    id: z.union([z.string().min(1), authzBindingIdFilterSchema]).optional(),
  })
  .strict();
export interface AuthzBindingFilterSchema extends Named<
  typeof authzBindingFilterSchemaDefinition
> {}
export const authzBindingFilterSchema: AuthzBindingFilterSchema =
  authzBindingFilterSchemaDefinition;
export type AuthzBindingFilter = z.infer<typeof authzBindingFilterSchema>;

const authzRevokeBindingsWhereInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    where: authzBindingFilterSchema,
    actor: ledgerActorSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();
export interface AuthzRevokeBindingsWhereInputSchema extends Named<
  typeof authzRevokeBindingsWhereInputSchemaDefinition
> {}
export const authzRevokeBindingsWhereInputSchema: AuthzRevokeBindingsWhereInputSchema =
  authzRevokeBindingsWhereInputSchemaDefinition;
export type AuthzRevokeBindingsWhereInput = z.infer<typeof authzRevokeBindingsWhereInputSchema>;
export const authzRevokeBindingsWhereOutputSchema = z.number().int().nonnegative();
export type AuthzRevokeBindingsWhereOutput = z.infer<typeof authzRevokeBindingsWhereOutputSchema>;

const authzOffboardMemberInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    revokedGrantIds: z.array(z.string().min(1)),
    actor: ledgerActorSchema,
  })
  .strict();
export interface AuthzOffboardMemberInputSchema extends Named<
  typeof authzOffboardMemberInputSchemaDefinition
> {}
export const authzOffboardMemberInputSchema: AuthzOffboardMemberInputSchema =
  authzOffboardMemberInputSchemaDefinition;
export type AuthzOffboardMemberInput = z.infer<typeof authzOffboardMemberInputSchema>;
export const authzOffboardMemberOutputSchema = z.void();
export type AuthzOffboardMemberOutput = z.infer<typeof authzOffboardMemberOutputSchema>;

const authzDefineRoleInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    roleId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string().min(1)),
    kind: authzRoleKindSchema,
    actor: ledgerActorSchema,
    /** Same contract as `authzAttachBindingsInputSchema.requireProjection`. */
    requireProjection: z.boolean().optional(),
  })
  .strict();
export interface AuthzDefineRoleInputSchema extends Named<
  typeof authzDefineRoleInputSchemaDefinition
> {}
export const authzDefineRoleInputSchema: AuthzDefineRoleInputSchema =
  authzDefineRoleInputSchemaDefinition;
export type AuthzDefineRoleInput = z.infer<typeof authzDefineRoleInputSchema>;
export const authzDefineRoleOutputSchema = z.void();
export type AuthzDefineRoleOutput = z.infer<typeof authzDefineRoleOutputSchema>;

const authzDeleteRoleInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    roleId: z.string().min(1),
    actor: ledgerActorSchema,
    awaitProjection: z.boolean().optional(),
  })
  .strict();
export interface AuthzDeleteRoleInputSchema extends Named<
  typeof authzDeleteRoleInputSchemaDefinition
> {}
export const authzDeleteRoleInputSchema: AuthzDeleteRoleInputSchema =
  authzDeleteRoleInputSchemaDefinition;
export type AuthzDeleteRoleInput = z.infer<typeof authzDeleteRoleInputSchema>;
export const authzDeleteRoleOutputSchema = z.void();
export type AuthzDeleteRoleOutput = z.infer<typeof authzDeleteRoleOutputSchema>;

const authzGrantActorSchemaDefinition = z.object({ userId: z.string().min(1) }).strict();
export interface AuthzGrantActorSchema extends Named<typeof authzGrantActorSchemaDefinition> {}
export const authzGrantActorSchema: AuthzGrantActorSchema = authzGrantActorSchemaDefinition;
export type AuthzGrantActor = z.infer<typeof authzGrantActorSchema>;

const grantPrincipalSchemaDefinition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("group"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("apiKey"), id: z.string().min(1) }).strict(),
]);
export interface GrantPrincipalSchema extends Named<typeof grantPrincipalSchemaDefinition> {}
export const grantPrincipalSchema: GrantPrincipalSchema = grantPrincipalSchemaDefinition;
export type GrantPrincipal = z.infer<typeof grantPrincipalSchema>;

const grantRoleSchemaDefinition = z.union([
  z.object({ builtin: z.enum(["ADMIN", "MEMBER", "VIEWER"]) }).strict(),
  z.object({ customRoleId: z.string().min(1) }).strict(),
]);
export interface GrantRoleSchema extends Named<typeof grantRoleSchemaDefinition> {}
export const grantRoleSchema: GrantRoleSchema = grantRoleSchemaDefinition;
export type GrantRole = z.infer<typeof grantRoleSchema>;

const authzAttachGrantInputSchemaDefinition = z
  .object({
    actor: authzGrantActorSchema,
    who: grantPrincipalSchema,
    role: grantRoleSchema,
    where: grantableAuthzScopeRefSchema,
    /** When the grant stops granting; absent for a grant that stands until revoked. */
    expiresAtMs: z.number().int().optional(),
  })
  .strict();
export interface AuthzAttachGrantInputSchema extends Named<
  typeof authzAttachGrantInputSchemaDefinition
> {}
export const authzAttachGrantInputSchema: AuthzAttachGrantInputSchema =
  authzAttachGrantInputSchemaDefinition;
export type AuthzAttachGrantInput = z.infer<typeof authzAttachGrantInputSchema>;

const authzBindingOutputSchemaDefinition = z.object({ bindingId: z.string().min(1) }).strict();
export interface AuthzBindingOutputSchema extends Named<
  typeof authzBindingOutputSchemaDefinition
> {}
export const authzBindingOutputSchema: AuthzBindingOutputSchema =
  authzBindingOutputSchemaDefinition;
export type AuthzBindingOutput = z.infer<typeof authzBindingOutputSchema>;

const authzUpdateGrantInputSchemaDefinition = z
  .object({
    actor: authzGrantActorSchema,
    bindingId: z.string().min(1),
    organizationId: z.string().min(1),
    role: grantRoleSchema,
  })
  .strict();
export interface AuthzUpdateGrantInputSchema extends Named<
  typeof authzUpdateGrantInputSchemaDefinition
> {}
export const authzUpdateGrantInputSchema: AuthzUpdateGrantInputSchema =
  authzUpdateGrantInputSchemaDefinition;
export type AuthzUpdateGrantInput = z.infer<typeof authzUpdateGrantInputSchema>;

const authzRevokeGrantInputSchemaDefinition = z
  .object({
    // The same widening offboard carries: a system principal (SCIM de-enroll,
    // a migration) revokes under its own name, and writeActor already renders
    // it here identically. Accepting only { userId } was the asymmetry, not a
    // rule.
    actor: z.union([authzGrantActorSchema, actorSchema]),
    bindingId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export interface AuthzRevokeGrantInputSchema extends Named<
  typeof authzRevokeGrantInputSchemaDefinition
> {}
export const authzRevokeGrantInputSchema: AuthzRevokeGrantInputSchema =
  authzRevokeGrantInputSchemaDefinition;
export type AuthzRevokeGrantInput = z.infer<typeof authzRevokeGrantInputSchema>;

const authzReplaceGrantInputSchemaDefinition = z
  .object({
    actor: authzGrantActorSchema,
    who: grantPrincipalSchema,
    from: grantableAuthzScopeRefSchema,
    to: grantableAuthzScopeRefSchema,
    role: grantRoleSchema,
    /** The replacement's own end date, never inferred from the grant it replaces. */
    expiresAtMs: z.number().int().optional(),
  })
  .strict();
export interface AuthzReplaceGrantInputSchema extends Named<
  typeof authzReplaceGrantInputSchemaDefinition
> {}
export const authzReplaceGrantInputSchema: AuthzReplaceGrantInputSchema =
  authzReplaceGrantInputSchemaDefinition;
export type AuthzReplaceGrantInput = z.infer<typeof authzReplaceGrantInputSchema>;

const authzOffboardInputSchemaDefinition = z
  .object({
    actor: z.union([authzGrantActorSchema, actorSchema]),
    userId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export interface AuthzOffboardInputSchema extends Named<
  typeof authzOffboardInputSchemaDefinition
> {}
export const authzOffboardInputSchema: AuthzOffboardInputSchema =
  authzOffboardInputSchemaDefinition;
export type AuthzOffboardInput = z.infer<typeof authzOffboardInputSchema>;

const offboardCountsSchemaDefinition = z
  .object({
    bindings: z.number().int().nonnegative(),
    groupMemberships: z.number().int().nonnegative(),
    legacyTeamMemberships: z.number().int().nonnegative(),
    pendingInvites: z.number().int().nonnegative(),
    organizationMembership: z.boolean(),
  })
  .strict();
export interface OffboardCountsSchema extends Named<typeof offboardCountsSchemaDefinition> {}
export const offboardCountsSchema: OffboardCountsSchema = offboardCountsSchemaDefinition;
export type OffboardCounts = z.infer<typeof offboardCountsSchema>;

const authzOffboardOutputSchemaDefinition = z
  .object({
    removed: offboardCountsSchema,
    needsHumanDecision: z
      .object({
        ownedApiKeys: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
        personalTeams: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
      })
      .strict(),
  })
  .strict();
export interface AuthzOffboardOutputSchema extends Named<
  typeof authzOffboardOutputSchemaDefinition
> {}
export const authzOffboardOutputSchema: AuthzOffboardOutputSchema =
  authzOffboardOutputSchemaDefinition;
export type AuthzOffboardOutput = z.infer<typeof authzOffboardOutputSchema>;
export type OffboardResult = AuthzOffboardOutput;
