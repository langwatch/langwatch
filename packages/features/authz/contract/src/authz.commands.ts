import { SYSTEM_ACTORS, type Actor, type SystemActorName } from "@langwatch/actor";
import { z } from "zod";
import {
  grantableAuthzScopeRefSchema,
  roleBindingScopeTypeSchema,
  teamUserRoleSchema,
} from "./authz";
import {
  grantEventSourceSchema,
  grantShapeRefinement,
  grantsLedgerActorSchema,
  ledgerPrincipalSchema,
  ledgerScopeSchema,
  legacyBindingRoleSchema,
  resourceGrantTermsSchema,
} from "./authz-grant.events";

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

function commandDataSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return commandIdentitySchema.extend(shape).refine(
    (data) => {
      const identity = data as { tenantId: string; organizationId: string };
      return identity.tenantId === identity.organizationId;
    },
    {
      message: "tenantId must equal organizationId: one grants ledger per organization",
      path: ["tenantId"],
    },
  );
}

export const attachGrantEntrySchema = z
  .object({
    grantId: z.string().min(1),
    principal: ledgerPrincipalSchema,
    roleKey: z.string().min(1).nullable(),
    scope: ledgerScopeSchema,
    resource: resourceGrantTermsSchema.optional(),
    legacyRole: legacyBindingRoleSchema.optional(),
    source: grantEventSourceSchema,
    actor: grantsLedgerActorSchema,
    occurredAtMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine(grantShapeRefinement.check, {
    message: grantShapeRefinement.message,
    path: [...grantShapeRefinement.path],
  });
export type AttachGrantEntry = z.infer<typeof attachGrantEntrySchema>;

export const attachGrantCommandDataSchema = commandDataSchema({
  grant: attachGrantEntrySchema,
});
export type AttachGrantCommandData = z.infer<typeof attachGrantCommandDataSchema>;

export const changeGrantRoleCommandDataSchema = commandDataSchema({
  grantId: z.string().min(1),
  from: z.string().min(1).nullable(),
  to: z.string().min(1),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type ChangeGrantRoleCommandData = z.infer<typeof changeGrantRoleCommandDataSchema>;

export const revokeGrantCommandDataSchema = commandDataSchema({
  grantId: z.string().min(1),
  reason: z.string().min(1).optional(),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type RevokeGrantCommandData = z.infer<typeof revokeGrantCommandDataSchema>;

export const defineRoleEntrySchema = z
  .object({
    roleId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string().min(1)),
    kind: authzRoleKindSchema,
    occurredAtMs: z.number().int().nonnegative(),
  })
  .strict();
export type DefineRoleEntry = z.infer<typeof defineRoleEntrySchema>;

export const defineRoleCommandDataSchema = commandDataSchema({
  role: defineRoleEntrySchema,
  actor: grantsLedgerActorSchema,
});
export type DefineRoleCommandData = z.infer<typeof defineRoleCommandDataSchema>;

export const changeRolePermissionsCommandDataSchema = commandDataSchema({
  roleId: z.string().min(1),
  permissions: z.array(z.string().min(1)),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type ChangeRolePermissionsCommandData = z.infer<
  typeof changeRolePermissionsCommandDataSchema
>;

export const deleteRoleCommandDataSchema = commandDataSchema({
  roleId: z.string().min(1),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type DeleteRoleCommandData = z.infer<typeof deleteRoleCommandDataSchema>;

/** Portable compatibility vocabulary for the existing grant mutation
 * consumers. These operations remain methods on AuthzGrantsService; this is
 * not a third public ledger-writer capability.
 *
 * It is `GRANT_EVENT_SOURCES` itself and not a subset of it: the ledger
 * writer types its own `source` as `GrantEventSource`, the persisted fact
 * validates against `grantEventSourceSchema`, and the audit adapter decides
 * auditability by naming `migration` and `read-through-mint` out of that same
 * list. A narrower input vocabulary here would refuse a source the writer
 * below it accepts, and would silently strand `join-request` — the one
 * source whose whole point is that it IS audited. */
export const authzLedgerWriteSourceSchema = grantEventSourceSchema;
export type AuthzLedgerWriteSource = z.infer<typeof authzLedgerWriteSourceSchema>;

export const authzLedgerBindingPrincipalSchema = z.union([
  z.object({ userId: z.string().min(1) }).strict(),
  z.object({ groupId: z.string().min(1) }).strict(),
  z.object({ apiKeyId: z.string().min(1) }).strict(),
]);
export type AuthzLedgerBindingPrincipal = z.infer<typeof authzLedgerBindingPrincipalSchema>;

export const authzLedgerBindingAttachSchema = z
  .object({
    bindingId: z.string().min(1),
    principal: authzLedgerBindingPrincipalSchema,
    role: teamUserRoleSchema,
    customRoleId: z.string().min(1).nullable(),
    scopeType: roleBindingScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export type AuthzLedgerBindingAttach = z.infer<typeof authzLedgerBindingAttachSchema>;

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
  const principalId =
    "userId" in principal
      ? principal.userId
      : "groupId" in principal
        ? principal.groupId
        : principal.apiKeyId;
  const roleIdentity = customRoleId === null ? `builtin:${role}` : `custom:${customRoleId}`;
  return [principalId, scopeType, scopeId, roleIdentity].join("\u001f");
}

export const authzAttachOutcomeSchema = z
  .object({
    attached: z.array(z.string().min(1)),
    duplicates: z.array(z.string().min(1)),
  })
  .strict();
export type AuthzAttachOutcome = z.infer<typeof authzAttachOutcomeSchema>;

export const authzAttachBindingsInputSchema = z
  .object({
    organizationId: z.string().min(1),
    bindings: z.array(authzLedgerBindingAttachSchema),
    actor: grantsLedgerActorSchema,
    source: authzLedgerWriteSourceSchema.optional(),
    onDuplicate: z.enum(["reject", "skip"]),
    commandId: z.string().min(1).optional(),
    occurredAtMs: z.number().int().nonnegative().optional(),
    awaitProjection: z.boolean().optional(),
  })
  .strict();
export type AuthzAttachBindingsInput = z.infer<typeof authzAttachBindingsInputSchema>;
export const authzAttachBindingsOutputSchema = authzAttachOutcomeSchema;
export type AuthzAttachBindingsOutput = AuthzAttachOutcome;

export const authzLedgerResourcePrincipalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("anyone"), id: z.null() }).strict(),
  z.object({ type: z.literal("organization"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("project"), id: z.string().min(1) }).strict(),
]);
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

export const authzLedgerResourceTermsSchema = z
  .object({
    token: z.string().min(1),
    permission: z.string().min(1),
    kind: z.enum(["trace", "thread"]),
    expiresAtMs: z.number().int().nonnegative().optional(),
    maxViews: z.number().int().nonnegative().optional(),
    createdByUserId: z.string().min(1).optional(),
  })
  .strict();
export type AuthzLedgerResourceTerms = z.infer<typeof authzLedgerResourceTermsSchema>;

export const authzAttachResourceGrantInputSchema = z
  .object({
    organizationId: z.string().min(1),
    grantId: z.string().min(1),
    projectId: z.string().min(1),
    resource: authzLedgerResourceTermsSchema,
    principal: authzLedgerResourcePrincipalSchema,
    scopeId: z.string().min(1),
    actor: grantsLedgerActorSchema,
    commandId: z.string().min(1).optional(),
  })
  .strict();
export type AuthzAttachResourceGrantInput = z.infer<typeof authzAttachResourceGrantInputSchema>;
export const authzAttachResourceGrantOutputSchema = z.void();
export type AuthzAttachResourceGrantOutput = z.infer<typeof authzAttachResourceGrantOutputSchema>;

export const authzRevokeResourceGrantsInputSchema = z
  .object({
    organizationId: z.string().min(1),
    grantIds: z.array(z.string().min(1)),
    actor: grantsLedgerActorSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();
export type AuthzRevokeResourceGrantsInput = z.infer<typeof authzRevokeResourceGrantsInputSchema>;
export const authzRevokeResourceGrantsOutputSchema = z.void();
export type AuthzRevokeResourceGrantsOutput = z.infer<typeof authzRevokeResourceGrantsOutputSchema>;

export const authzChangeBindingRoleInputSchema = z
  .object({
    organizationId: z.string().min(1),
    bindingId: z.string().min(1),
    role: teamUserRoleSchema,
    customRoleId: z.string().min(1).nullable(),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type AuthzChangeBindingRoleInput = z.infer<typeof authzChangeBindingRoleInputSchema>;
export const authzChangeBindingRoleOutputSchema = z.void();
export type AuthzChangeBindingRoleOutput = z.infer<typeof authzChangeBindingRoleOutputSchema>;

export const authzRevokeBindingsInputSchema = z
  .object({
    organizationId: z.string().min(1),
    bindingIds: z.array(z.string().min(1)),
    actor: grantsLedgerActorSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();
export type AuthzRevokeBindingsInput = z.infer<typeof authzRevokeBindingsInputSchema>;
export const authzRevokeBindingsOutputSchema = z.void();
export type AuthzRevokeBindingsOutput = z.infer<typeof authzRevokeBindingsOutputSchema>;

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
export const authzBindingFilterSchema = z
  .object({
    userId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    apiKeyId: z.string().min(1).optional(),
    customRoleId: z.union([z.string().min(1), authzStringSetFilterSchema]).optional(),
    scopeType: roleBindingScopeTypeSchema.optional(),
    scopeId: z.string().min(1).optional(),
    id: z.union([z.string().min(1), authzBindingIdFilterSchema]).optional(),
  })
  .strict();
export type AuthzBindingFilter = z.infer<typeof authzBindingFilterSchema>;

export const authzRevokeBindingsWhereInputSchema = z
  .object({
    organizationId: z.string().min(1),
    where: authzBindingFilterSchema,
    actor: grantsLedgerActorSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();
export type AuthzRevokeBindingsWhereInput = z.infer<typeof authzRevokeBindingsWhereInputSchema>;
export const authzRevokeBindingsWhereOutputSchema = z.number().int().nonnegative();
export type AuthzRevokeBindingsWhereOutput = z.infer<typeof authzRevokeBindingsWhereOutputSchema>;

export const authzOffboardMemberInputSchema = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    revokedGrantIds: z.array(z.string().min(1)),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type AuthzOffboardMemberInput = z.infer<typeof authzOffboardMemberInputSchema>;
export const authzOffboardMemberOutputSchema = z.void();
export type AuthzOffboardMemberOutput = z.infer<typeof authzOffboardMemberOutputSchema>;

export const authzDefineRoleInputSchema = z
  .object({
    organizationId: z.string().min(1),
    roleId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string().min(1)),
    kind: authzRoleKindSchema,
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type AuthzDefineRoleInput = z.infer<typeof authzDefineRoleInputSchema>;
export const authzDefineRoleOutputSchema = z.void();
export type AuthzDefineRoleOutput = z.infer<typeof authzDefineRoleOutputSchema>;

export const authzDeleteRoleInputSchema = z
  .object({
    organizationId: z.string().min(1),
    roleId: z.string().min(1),
    actor: grantsLedgerActorSchema,
    awaitProjection: z.boolean().optional(),
  })
  .strict();
export type AuthzDeleteRoleInput = z.infer<typeof authzDeleteRoleInputSchema>;
export const authzDeleteRoleOutputSchema = z.void();
export type AuthzDeleteRoleOutput = z.infer<typeof authzDeleteRoleOutputSchema>;

export const authzGrantActorSchema = z.object({ userId: z.string().min(1) }).strict();
export type AuthzGrantActor = z.infer<typeof authzGrantActorSchema>;

const systemActorNameSchema = z.custom<SystemActorName>(
  (value) => typeof value === "string" && Object.hasOwn(SYSTEM_ACTORS, value),
);
const actorSchema: z.ZodType<Actor> = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("user"),
      id: z.string().min(1),
      impersonatorId: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ type: z.literal("api_key"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("system"), name: systemActorNameSchema }).strict(),
  z
    .object({
      type: z.literal("internal"),
      codePath: z.string().min(1),
      revision: z.string().min(1).optional(),
    })
    .strict(),
]);

export const grantPrincipalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("group"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("apiKey"), id: z.string().min(1) }).strict(),
]);
export type GrantPrincipal = z.infer<typeof grantPrincipalSchema>;

export const grantRoleSchema = z.union([
  z.object({ builtin: z.enum(["ADMIN", "MEMBER", "VIEWER"]) }).strict(),
  z.object({ customRoleId: z.string().min(1) }).strict(),
]);
export type GrantRole = z.infer<typeof grantRoleSchema>;

export const authzAttachGrantInputSchema = z
  .object({
    actor: authzGrantActorSchema,
    who: grantPrincipalSchema,
    role: grantRoleSchema,
    where: grantableAuthzScopeRefSchema,
  })
  .strict();
export type AuthzAttachGrantInput = z.infer<typeof authzAttachGrantInputSchema>;

export const authzBindingOutputSchema = z.object({ bindingId: z.string().min(1) }).strict();
export type AuthzBindingOutput = z.infer<typeof authzBindingOutputSchema>;

export const authzUpdateGrantInputSchema = z
  .object({
    actor: authzGrantActorSchema,
    bindingId: z.string().min(1),
    organizationId: z.string().min(1),
    role: grantRoleSchema,
  })
  .strict();
export type AuthzUpdateGrantInput = z.infer<typeof authzUpdateGrantInputSchema>;

export const authzRevokeGrantInputSchema = z
  .object({
    actor: authzGrantActorSchema,
    bindingId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export type AuthzRevokeGrantInput = z.infer<typeof authzRevokeGrantInputSchema>;

export const authzReplaceGrantInputSchema = z
  .object({
    actor: authzGrantActorSchema,
    who: grantPrincipalSchema,
    from: grantableAuthzScopeRefSchema,
    to: grantableAuthzScopeRefSchema,
    role: grantRoleSchema,
  })
  .strict();
export type AuthzReplaceGrantInput = z.infer<typeof authzReplaceGrantInputSchema>;

export const authzOffboardInputSchema = z
  .object({
    actor: z.union([authzGrantActorSchema, actorSchema]),
    userId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export type AuthzOffboardInput = z.infer<typeof authzOffboardInputSchema>;

export const offboardCountsSchema = z
  .object({
    bindings: z.number().int().nonnegative(),
    groupMemberships: z.number().int().nonnegative(),
    legacyTeamMemberships: z.number().int().nonnegative(),
    pendingInvites: z.number().int().nonnegative(),
    organizationMembership: z.boolean(),
  })
  .strict();
export type OffboardCounts = z.infer<typeof offboardCountsSchema>;

export const authzOffboardOutputSchema = z
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
export type AuthzOffboardOutput = z.infer<typeof authzOffboardOutputSchema>;
export type OffboardResult = AuthzOffboardOutput;
