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
  "cutover-import",
]);

export const grantsLedgerActorSchema = z.object({
  type: z.enum(["user", "system"]),
  id: z.string().nullable(),
});

/** `kind` and `projectId` are required, not optional-tolerant: nothing has
 *  ever emitted resource terms, so there is no stored event these fields
 *  could be missing from, and a resource fact without them cannot say which
 *  thing it opens or where that thing lives. `createdByUserId` is genuinely
 *  optional — a link nobody minted by hand has no author. */
export const resourceGrantTermsSchema = z.object({
  kind: z.enum(["trace", "thread"]),
  projectId: z.string().min(1),
  token: z.string().min(1),
  permission: z.string().min(1),
  createdByUserId: z.string().min(1).optional(),
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
 * The `anyone` principal is resource-tier only (delivery plan, the `Grant`
 * shape). That one is a security boundary rather than a tidiness rule:
 * `anyone` names no subject, so an `anyone` grant at ORGANIZATION or TEAM
 * scope is a standing public grant over the whole tenant, held by nobody and
 * revocable by no principal. It is only meaningful paired with a token, and
 * tokens exist at RESOURCE scope alone.
 *
 * The `project` principal has exactly two legal placements: the resource tier
 * (a share link whose audience is "members who can see this project"), and
 * its OWN project's PROJECT scope — the project-credential self-grant the
 * cutover imports, `Project.apiKey` acting as the project it belongs to. The
 * self-grant is the contract the edge will resolve a project credential
 * against once bare column comparison retires; it is dormant until then (no
 * collector returns PROJECT-principal rows for a user or an api key). Any
 * other placement — a project principal on a foreign project, a team, or the
 * organization — would be a standing cross-scope credential nobody holds, and
 * is refused.
 */
export const grantShapeRefinement = {
  check: (grant: {
    principal: { type: string; id: string | null };
    roleKey: string | null;
    scope: { type: string; id: string };
    resource?: unknown;
  }): boolean => {
    const isResourceScope = grant.scope.type === "RESOURCE";
    if (grant.principal.type === "anyone" && !isResourceScope) {
      return false;
    }
    const isOwnProjectCredential =
      grant.scope.type === "PROJECT" && grant.principal.id === grant.scope.id;
    if (
      grant.principal.type === "project" &&
      !isResourceScope &&
      !isOwnProjectCredential
    ) {
      return false;
    }
    return (
      isResourceScope === (grant.resource !== undefined) &&
      isResourceScope === (grant.roleKey === null)
    );
  },
  message:
    "a RESOURCE grant carries resource terms and a null roleKey, every other scope carries a roleKey and no resource terms; `anyone` principals exist only at RESOURCE scope, and a `project` principal exists at RESOURCE scope or as its own project's credential (a PROJECT scope whose id is the principal's)",
  path: ["resource"] as const,
};

export const grantAttachedEventSchema = EventSchema.extend({
  type: z.literal(GRANT_ATTACHED_EVENT_TYPE),
  data: z
    .object({
      grantId: z.string().min(1),
      principal: ledgerPrincipalSchema,
      roleKey: z.string().min(1).nullable(),
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
    grantId: z.string().min(1),
    from: z.string().min(1).nullable(),
    to: z.string().min(1),
    actor: grantsLedgerActorSchema,
  }),
});
export type GrantRoleChangedEvent = z.infer<typeof grantRoleChangedEventSchema>;

/**
 * Which grants a revocation names by IDENTITY rather than by id.
 *
 * A revoke-by-filter resolves its ids from the compat projection, and that
 * projection lags the ledger by a fold: a grant appended a moment earlier is
 * invisible to the query, so an id list alone leaves it standing. Carrying the
 * identity the caller filtered on lets the FOLD — which sees what the stream
 * itself produced — remove every grant that matches. The reducer applies it
 * against the state at that point in the stream, so a replay reproduces the
 * same removal (`GrantRevocationSelector` in @langwatch/authz-server).
 */
export const grantRevocationSelectorSchema = z.object({
  principal: ledgerPrincipalSchema,
  /** Present when the caller filtered on one scope; absent means the
   *  principal's grants at every scope. */
  scope: ledgerScopeSchema.optional(),
});

export const grantRevokedEventSchema = EventSchema.extend({
  type: z.literal(GRANT_REVOKED_EVENT_TYPE),
  data: z
    .object({
      /** Absent only on a revoke-by-identity whose lagging projection listed
       *  no id at all — the selector is then the whole instruction. */
      grantId: z.string().min(1).optional(),
      selector: grantRevocationSelectorSchema.optional(),
      reason: z.string().min(1).optional(),
      actor: grantsLedgerActorSchema,
    })
    .refine(
      (data) => data.grantId !== undefined || data.selector !== undefined,
      {
        message:
          "a revocation names a grant id, an identity selector, or both — never neither",
        path: ["grantId"],
      },
    ),
});
export type GrantRevokedEvent = z.infer<typeof grantRevokedEventSchema>;

export const roleDefinedEventSchema = EventSchema.extend({
  type: z.literal(ROLE_DEFINED_EVENT_TYPE),
  data: z.object({
    roleId: z.string().min(1),
    name: z.string().min(1),
    /** No `.min(1)`: an imported role may carry an empty description, and
     *  refusing it would park a genesis import over a blank field. */
    description: z.string().optional(),
    permissions: z.array(z.string().min(1)),
    kind: z.enum(["custom", "system_api_key"]),
    actor: grantsLedgerActorSchema,
  }),
});
export type RoleDefinedEvent = z.infer<typeof roleDefinedEventSchema>;

export const rolePermissionsChangedEventSchema = EventSchema.extend({
  type: z.literal(ROLE_PERMISSIONS_CHANGED_EVENT_TYPE),
  data: z.object({
    roleId: z.string().min(1),
    permissions: z.array(z.string().min(1)),
    actor: grantsLedgerActorSchema,
  }),
});
export type RolePermissionsChangedEvent = z.infer<
  typeof rolePermissionsChangedEventSchema
>;

export const roleDeletedEventSchema = EventSchema.extend({
  type: z.literal(ROLE_DELETED_EVENT_TYPE),
  data: z.object({
    roleId: z.string().min(1),
    actor: grantsLedgerActorSchema,
  }),
});
export type RoleDeletedEvent = z.infer<typeof roleDeletedEventSchema>;

export const memberOffboardedEventSchema = EventSchema.extend({
  type: z.literal(MEMBER_OFFBOARDED_EVENT_TYPE),
  data: z.object({
    userId: z.string().min(1),
    /** The ids the writer could see — the audit trail's record of the
     *  revocation. The fold does not depend on the list being complete: it
     *  sweeps every grant the principal holds (ADR-092 §13, the reducer's
     *  `grantIdsForUser`). */
    revokedGrantIds: z.array(z.string().min(1)),
    actor: grantsLedgerActorSchema,
  }),
});
export type MemberOffboardedEvent = z.infer<typeof memberOffboardedEventSchema>;

export const migrationParityProvedEventSchema = EventSchema.extend({
  type: z.literal(MIGRATION_PARITY_PROVED_EVENT_TYPE),
  data: z.object({
    /** Empty means clean — the organization may finalize. */
    diffs: z.array(z.string().min(1)),
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
    reason: z.string().min(1).optional(),
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
    migrationName: z.string().min(1),
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
