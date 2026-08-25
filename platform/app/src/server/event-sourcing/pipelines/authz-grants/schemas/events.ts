import { GRANT_EVENT_SOURCES } from "@langwatch/authz-server";
import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GROUP_MEMBER_ADDED_EVENT_TYPE,
  GROUP_MEMBER_REMOVED_EVENT_TYPE,
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
      "apiKey",
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

/** Derived, never restated: a source added to the vocabulary is accepted on
 *  the wire with no edit here. */
export const grantEventSourceSchema = z.enum(GRANT_EVENT_SOURCES);

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
 * `expiresAtMs` on the grant itself is the binding tiers' time box, and is
 * refused at RESOURCE scope: a share link states its expiry inside its terms
 * and always has, so accepting both would give one row two expiries and no
 * rule about which wins.
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
    expiresAtMs?: number;
  }): boolean => {
    const isResourceScope = grant.scope.type === "RESOURCE";
    if (grant.principal.type === "anyone" && !isResourceScope) {
      return false;
    }
    if (isResourceScope && grant.expiresAtMs !== undefined) {
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
    "a RESOURCE grant carries resource terms and a null roleKey, every other scope carries a roleKey and no resource terms; a RESOURCE grant states its expiry inside those terms and never as the grant's own `expiresAtMs`; `anyone` principals exist only at RESOURCE scope, and a `project` principal exists at RESOURCE scope or as its own project's credential (a PROJECT scope whose id is the principal's)",
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
      /**
       * When a binding-tier grant stops granting. ADDITIVE: every event ever
       * appended lacks it, and an event without it folds to exactly the row
       * it folded to before - `Grant.expiresAt` null, granting until revoked.
       * `.positive()` because epoch 0 is not a date anybody means, and a
       * grant that expired in 1970 would be a fact that never granted.
       */
      expiresAtMs: z.number().int().positive().optional(),
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

/** A revoke names its grant, and only its grant: the aggregate IS the grant,
 *  so an event cannot address a set of them. */
export const grantRevokedEventSchema = EventSchema.extend({
  type: z.literal(GRANT_REVOKED_EVENT_TYPE),
  data: z.object({
    grantId: z.string().min(1),
    reason: z.string().min(1).optional(),
    actor: grantsLedgerActorSchema,
  }),
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

/**
 * One person joined one group (ADR-125's named prerequisite).
 *
 * The membership names no role, no scope and no permission, because a
 * membership grants nothing by itself — what it does is make every grant the
 * GROUP holds reach the user, since COLLECT unions `{user} ∪ groups`. That
 * indirection is exactly why the fact has to be on the ledger: without it a
 * removal left no trace anywhere, and a past-tense access answer computed
 * afterwards understated the access that really existed.
 *
 * `membershipId` is the aggregate id, minted per fact rather than derived from
 * the pair: the pair repeats. Somebody removed from a group can be added back,
 * and that is a new membership with its own beginning and its own end — a
 * second `group_member_added` on the SAME id would read as a redelivery of
 * the first and fold to nothing.
 *
 * No `actor.type: "anyone"` question arises here and no principal union is
 * needed: a membership names one user and one group, both required.
 */
export const groupMemberAddedEventSchema = EventSchema.extend({
  type: z.literal(GROUP_MEMBER_ADDED_EVENT_TYPE),
  data: z.object({
    membershipId: z.string().min(1),
    groupId: z.string().min(1),
    userId: z.string().min(1),
    source: grantEventSourceSchema,
    actor: grantsLedgerActorSchema,
  }),
});
export type GroupMemberAddedEvent = z.infer<typeof groupMemberAddedEventSchema>;

/**
 * A removal names one membership, and only one: a selector cannot address an
 * aggregate, so a caller with a set of them sends a command each — the same
 * rule `grant_revoked` follows.
 *
 * It carries `groupId` and `userId` as well as the membership id, and both are
 * load-bearing rather than decoration. They are what the command derives its
 * AGGREGATE from (`groupMembershipAggregateId`), which is what puts this event
 * in the same FIFO lane as the `added` for its pair — including the `added`
 * for a LATER membership of the same pair, which is the ordering the row id
 * alone cannot express. They are also what lets the audit row name who left
 * which group once the membership row itself is gone.
 */
export const groupMemberRemovedEventSchema = EventSchema.extend({
  type: z.literal(GROUP_MEMBER_REMOVED_EVENT_TYPE),
  data: z.object({
    membershipId: z.string().min(1),
    groupId: z.string().min(1),
    userId: z.string().min(1),
    /** Carried where the caller stated one, exactly as `grant_revoked` does:
     *  "when did this access end, and why" is one question, not two. */
    reason: z.string().min(1).optional(),
    actor: grantsLedgerActorSchema,
  }),
});
export type GroupMemberRemovedEvent = z.infer<
  typeof groupMemberRemovedEventSchema
>;

export const authzGrantsEventSchema = z.discriminatedUnion("type", [
  grantAttachedEventSchema,
  grantRoleChangedEventSchema,
  grantRevokedEventSchema,
  roleDefinedEventSchema,
  rolePermissionsChangedEventSchema,
  roleDeletedEventSchema,
  groupMemberAddedEventSchema,
  groupMemberRemovedEventSchema,
]);
export type AuthzGrantsEvent = z.infer<typeof authzGrantsEventSchema>;
