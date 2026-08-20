import { z } from "zod";
import {
  grantEventSourceSchema,
  grantShapeRefinement,
  grantsLedgerActorSchema,
  ledgerPrincipalSchema,
  ledgerScopeSchema,
  legacyBindingRoleSchema,
  resourceGrantTermsSchema,
} from "./events";

/**
 * Command payloads for the grants ledger (ADR-092 §13).
 *
 * Every command carries a caller-minted `commandId` (delivery-plan decision
 * 23): the caller mints it once, retries reuse it, and each emitted event's
 * `idempotencyKey` is `<commandId>:<index>` — so a retried command dedupes
 * at the event store while a legitimately repeated action never can.
 * Migrations derive their commandIds deterministically from source rows
 * (`backfill-b:<rowId>`); user-action paths mint a random KSUID.
 */

const commandIdentitySchema = z.object({
  /** The organization IS the tenant of its own ledger; the framework builds
   *  the command envelope's tenantId from this payload field. */
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  commandId: z.string().min(1),
});

/**
 * Every command payload in this ledger carries the identity block AND the
 * invariant that makes it one ledger: `tenantId === organizationId`.
 *
 * The organization is the TENANT of both aggregates (ADR-110) — the stream
 * an event is persisted under and the routing key that places it. It is the
 * AGGREGATE of only `authz_org_policy`; a grant command's aggregate is its
 * own grant id. A caller that wired tenantId and organizationId to different
 * values would persist the event under one tenant's stream and fold it into
 * a different organization's projection, and nothing later in the pipeline
 * can detect that, which is why it is refused at the wire boundary.
 */
function commandDataSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return commandIdentitySchema
    .extend(shape)
    .refine((data) => data.tenantId === data.organizationId, {
      message:
        "tenantId must equal organizationId: one grants ledger per organization",
      path: ["tenantId"],
    });
}

export const attachGrantEntrySchema = z
  .object({
    grantId: z.string().min(1),
    principal: ledgerPrincipalSchema,
    roleKey: z.string().min(1).nullable(),
    scope: ledgerScopeSchema,
    resource: resourceGrantTermsSchema.optional(),
    /** Imported bindings only — the legacy `role` column a `custom:<id>`
     *  roleKey cannot carry (see the schema in events.ts). */
    legacyRole: legacyBindingRoleSchema.optional(),
    source: grantEventSourceSchema,
    actor: grantsLedgerActorSchema,
    /** Business time of the fact — a backfilled grant carries the legacy
     *  row's createdAt; it becomes the emitted event's `occurredAt`. */
    occurredAtMs: z.number().int().nonnegative(),
  })
  // Same invariant the emitted event is held to — checked on the way IN so a
  // malformed batch is refused with the command that sent it, rather than
  // surfacing later as an event nobody can attribute.
  .refine(grantShapeRefinement.check, {
    message: grantShapeRefinement.message,
    path: [...grantShapeRefinement.path],
  });
export type AttachGrantEntry = z.infer<typeof attachGrantEntrySchema>;

/**
 * One command, one grant, one aggregate (ADR-110). The batched form this
 * replaces emitted an event per entry onto a single organization-wide
 * aggregate; with the grant as the aggregate a batch would have to straddle
 * hundreds of them, so the import sends one of these per grant instead. They
 * are independent and fold concurrently, which is the point.
 */
export const attachGrantCommandDataSchema = commandDataSchema({
  grant: attachGrantEntrySchema,
});
export type AttachGrantCommandData = z.infer<
  typeof attachGrantCommandDataSchema
>;

export const changeGrantRoleCommandDataSchema = commandDataSchema({
  grantId: z.string().min(1),
  from: z.string().min(1).nullable(),
  to: z.string().min(1),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type ChangeGrantRoleCommandData = z.infer<
  typeof changeGrantRoleCommandDataSchema
>;

/**
 * One revocation, one aggregate (ADR-110). A revoke names its grant id and
 * nothing else: a selector cannot address an aggregate, so resolving "every
 * grant this principal holds at this scope" into ids is the caller's job now.
 *
 * Two things make that safe rather than a hole. Grant ids are derived from
 * content, so a caller that knows the fact can derive its id without reading
 * the lagging projection at all. And where the set genuinely is not known —
 * offboarding — the deny is enforced synchronously against the projection
 * before the call returns (the sanctioned direct write, ADR-092 decision 7),
 * so access ends immediately and these events are the durable record rather
 * than the mechanism.
 */
export const revokeGrantCommandDataSchema = commandDataSchema({
  grantId: z.string().min(1),
  reason: z.string().min(1).optional(),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type RevokeGrantCommandData = z.infer<
  typeof revokeGrantCommandDataSchema
>;

export const defineRoleEntrySchema = z.object({
  roleId: z.string().min(1),
  name: z.string().min(1),
  /** No `.min(1)`: an imported role may carry an empty description (see the
   *  event schema), and refusing it would park a genesis import. */
  description: z.string().optional(),
  permissions: z.array(z.string().min(1)),
  kind: z.enum(["custom", "system_api_key"]),
  /** Business time of the fact — an imported role carries the legacy
   *  row's createdAt; it becomes the emitted event's `occurredAt`. */
  occurredAtMs: z.number().int().nonnegative(),
});
export type DefineRoleEntry = z.infer<typeof defineRoleEntrySchema>;

/** One command, one role, one aggregate (ADR-110) — the same rule the
 *  grant commands follow, for the same reason. */
export const defineRoleCommandDataSchema = commandDataSchema({
  role: defineRoleEntrySchema,
  actor: grantsLedgerActorSchema,
});
export type DefineRoleCommandData = z.infer<
  typeof defineRoleCommandDataSchema
>;

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
