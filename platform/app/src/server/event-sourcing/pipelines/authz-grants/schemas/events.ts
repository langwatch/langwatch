import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  CUTOVER_COMPLETED_EVENT_TYPE,
  CUTOVER_ROLLED_BACK_EVENT_TYPE,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  MEMBER_OFFBOARDED_EVENT_TYPE,
  MIGRATION_PARITY_PROVED_EVENT_TYPE,
  MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "./constants";

/**
 * The grants ledger's wire schemas (ADR-092 §13). Payloads mirror the pure
 * reducer's fact types in `@langwatch/authz-server` — the fold validates
 * here, maps onto those types, and applies with `reduceGrantsLedger`, so
 * live dispatch and replay run the identical function.
 *
 * Time lives on the event envelope, not the payload: `occurredAt` is
 * business time (a backfilled grant carries the legacy row's `createdAt`),
 * `createdAt` is ledger-accepted time. Payloads carry ids, enums and
 * registry permission strings only — never emails, names, or secrets
 * (except the resource tier's possession token, which IS the credential
 * and lives nowhere else).
 */

/**
 * `anyone` is the resource tier's public principal and is the ONLY type
 * whose id is null — it names no subject, possession of the token is the
 * whole claim. Every other type must carry the id it names.
 *
 * Enforced here rather than left to the reducer: a `{ type: "user", id: null }`
 * event folds into a grant that matches no user and can never be revoked by
 * one, and an `{ type: "anyone", id: "user_x" }` event is a public grant
 * wearing a subject's name. Both are unrepresentable states, so the wire
 * boundary is where they stop.
 */
export const ledgerPrincipalSchema = z
  .object({
    type: z.enum([
      "user",
      "api_key",
      "group",
      "team",
      "organization",
      "project",
      "anyone",
    ]),
    id: z.string().nullable(),
  })
  .refine(
    (principal) => (principal.type === "anyone") === (principal.id === null),
    {
      message:
        "principal id is null for `anyone` and required for every other principal type",
      path: ["id"],
    },
  );

/**
 * The `role` column an IMPORTED binding carried, kept alongside a
 * `custom:<id>` roleKey. `roleKey` cannot express it, and the legacy resolver
 * still reads it: a custom role with an empty permission list falls back to
 * the row's own role, so a binding projected as CUSTOM answers `viewer` where
 * the legacy row answered `admin`. Carried on the EVENT rather than read back
 * at fold time, so a replay reproduces the same compat row.
 */
export const legacyBindingRoleSchema = z.enum([
  "ADMIN",
  "MEMBER",
  "VIEWER",
  "CUSTOM",
]);

export const ledgerScopeSchema = z.object({
  type: z.enum(["ORGANIZATION", "TEAM", "PROJECT", "RESOURCE", "PLATFORM"]),
  id: z.string(),
});

export const grantEventSourceSchema = z.enum([
  "grants-service",
  "scim",
  "invite",
  "backfill-b",
  "genesis-import",
  "read-through-mint",
]);

export const grantsLedgerActorSchema = z.object({
  type: z.enum(["user", "system"]),
  id: z.string().nullable(),
});

export const resourceGrantTermsSchema = z.object({
  token: z.string(),
  permission: z.string(),
  expiresAtMs: z.number().int().nonnegative().optional(),
  maxViews: z.number().int().nonnegative().optional(),
});

/**
 * The resource tier and every other tier are mutually exclusive shapes, and
 * the split is total: a RESOURCE grant carries its terms and no role (the
 * token's single `permission` IS what it may do), while every other grant
 * carries a role and no terms.
 *
 * Both halves matter. A RESOURCE grant that arrived without terms folds into
 * a row whose `token` is null — an unreachable share link that
 * `Grant_resource_terms_check` would then have to reject at the database, one
 * layer too late to name the event that caused it. A non-RESOURCE grant that
 * arrived WITH terms mints a share token against an organization- or
 * team-wide grant, which is a public credential for a scope no share link is
 * ever supposed to reach.
 *
 * The `anyone` and `project` principals are resource-tier only (delivery plan,
 * the `Grant` shape: "project | anyone -- last two: resource tier only"). That
 * one is a security boundary rather than a tidiness rule: `anyone` names no
 * subject, so an `anyone` grant at ORGANIZATION or TEAM scope is a standing
 * public grant over the whole tenant, held by nobody and revocable by no
 * principal. It is only meaningful paired with a token, and tokens exist at
 * RESOURCE scope alone.
 */
const RESOURCE_ONLY_PRINCIPALS = new Set(["anyone", "project"]);

export const grantShapeRefinement = {
  check: (grant: {
    principal: { type: string };
    roleKey: string | null;
    scope: { type: string };
    resource?: unknown;
  }): boolean => {
    const isResourceScope = grant.scope.type === "RESOURCE";
    if (
      RESOURCE_ONLY_PRINCIPALS.has(grant.principal.type) &&
      !isResourceScope
    ) {
      return false;
    }
    return (
      isResourceScope === (grant.resource !== undefined) &&
      isResourceScope === (grant.roleKey === null)
    );
  },
  message:
    "a RESOURCE grant carries resource terms and a null roleKey, every other scope carries a roleKey and no resource terms, and the `anyone` and `project` principals exist only at RESOURCE scope",
  path: ["resource"] as const,
};

export const grantAttachedEventSchema = EventSchema.extend({
  type: z.literal(GRANT_ATTACHED_EVENT_TYPE),
  data: z
    .object({
      grantId: z.string(),
      principal: ledgerPrincipalSchema,
      roleKey: z.string().nullable(),
      scope: ledgerScopeSchema,
      resource: resourceGrantTermsSchema.optional(),
      legacyRole: legacyBindingRoleSchema.optional(),
      source: grantEventSourceSchema,
      actor: grantsLedgerActorSchema,
    })
    .refine(grantShapeRefinement.check, {
      message: grantShapeRefinement.message,
      path: [...grantShapeRefinement.path],
    }),
});
export type GrantAttachedEvent = z.infer<typeof grantAttachedEventSchema>;

export const grantRoleChangedEventSchema = EventSchema.extend({
  type: z.literal(GRANT_ROLE_CHANGED_EVENT_TYPE),
  data: z.object({
    grantId: z.string(),
    from: z.string().nullable(),
    to: z.string(),
    actor: grantsLedgerActorSchema,
  }),
});
export type GrantRoleChangedEvent = z.infer<typeof grantRoleChangedEventSchema>;

export const grantRevokedEventSchema = EventSchema.extend({
  type: z.literal(GRANT_REVOKED_EVENT_TYPE),
  data: z.object({
    grantId: z.string(),
    reason: z.string().optional(),
    actor: grantsLedgerActorSchema,
  }),
});
export type GrantRevokedEvent = z.infer<typeof grantRevokedEventSchema>;

export const roleDefinedEventSchema = EventSchema.extend({
  type: z.literal(ROLE_DEFINED_EVENT_TYPE),
  data: z.object({
    roleId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    permissions: z.array(z.string()),
    kind: z.enum(["custom", "system_api_key"]),
    actor: grantsLedgerActorSchema,
  }),
});
export type RoleDefinedEvent = z.infer<typeof roleDefinedEventSchema>;

export const rolePermissionsChangedEventSchema = EventSchema.extend({
  type: z.literal(ROLE_PERMISSIONS_CHANGED_EVENT_TYPE),
  data: z.object({
    roleId: z.string(),
    permissions: z.array(z.string()),
    actor: grantsLedgerActorSchema,
  }),
});
export type RolePermissionsChangedEvent = z.infer<
  typeof rolePermissionsChangedEventSchema
>;

export const roleDeletedEventSchema = EventSchema.extend({
  type: z.literal(ROLE_DELETED_EVENT_TYPE),
  data: z.object({
    roleId: z.string(),
    actor: grantsLedgerActorSchema,
  }),
});
export type RoleDeletedEvent = z.infer<typeof roleDeletedEventSchema>;

export const memberOffboardedEventSchema = EventSchema.extend({
  type: z.literal(MEMBER_OFFBOARDED_EVENT_TYPE),
  data: z.object({
    userId: z.string(),
    revokedGrantIds: z.array(z.string()),
    actor: grantsLedgerActorSchema,
  }),
});
export type MemberOffboardedEvent = z.infer<typeof memberOffboardedEventSchema>;

export const migrationParityProvedEventSchema = EventSchema.extend({
  type: z.literal(MIGRATION_PARITY_PROVED_EVENT_TYPE),
  data: z.object({
    /** Empty means clean — the organization may finalize. */
    diffs: z.array(z.string()),
  }),
});
export type MigrationParityProvedEvent = z.infer<
  typeof migrationParityProvedEventSchema
>;

export const cutoverCompletedEventSchema = EventSchema.extend({
  type: z.literal(CUTOVER_COMPLETED_EVENT_TYPE),
  data: z.object({
    actor: grantsLedgerActorSchema,
  }),
});
export type CutoverCompletedEvent = z.infer<typeof cutoverCompletedEventSchema>;

export const cutoverRolledBackEventSchema = EventSchema.extend({
  type: z.literal(CUTOVER_ROLLED_BACK_EVENT_TYPE),
  data: z.object({
    reason: z.string().optional(),
    actor: grantsLedgerActorSchema,
  }),
});
export type CutoverRolledBackEvent = z.infer<
  typeof cutoverRolledBackEventSchema
>;

/** The runner's per-(migration, tenant) status vocabulary — mirrored from
 *  @langwatch/system-migrations without importing it (the wire schema must
 *  not couple to the runner package). */
export const migrationTenantStatusSchema = z.enum([
  "migrated",
  "finalized",
  "parked",
  "rolled_back",
]);

export const migrationTenantStateChangedEventSchema = EventSchema.extend({
  type: z.literal(MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE),
  data: z.object({
    migrationName: z.string(),
    status: migrationTenantStatusSchema,
    /** The runner's report for the transition, JSON as stored. */
    report: z.unknown().nullish(),
    actor: grantsLedgerActorSchema,
  }),
});
export type MigrationTenantStateChangedEvent = z.infer<
  typeof migrationTenantStateChangedEventSchema
>;

export const authzGrantsEventSchema = z.discriminatedUnion("type", [
  grantAttachedEventSchema,
  grantRoleChangedEventSchema,
  grantRevokedEventSchema,
  roleDefinedEventSchema,
  rolePermissionsChangedEventSchema,
  roleDeletedEventSchema,
  memberOffboardedEventSchema,
  migrationParityProvedEventSchema,
  cutoverCompletedEventSchema,
  cutoverRolledBackEventSchema,
  migrationTenantStateChangedEventSchema,
]);
export type AuthzGrantsEvent = z.infer<typeof authzGrantsEventSchema>;
