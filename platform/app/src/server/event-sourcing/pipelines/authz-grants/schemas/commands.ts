import { z } from "zod";
import {
  grantEventSourceSchema,
  grantRevocationSelectorSchema,
  grantShapeRefinement,
  grantsLedgerActorSchema,
  ledgerPrincipalSchema,
  ledgerScopeSchema,
  legacyBindingRoleSchema,
  migrationTenantStatusSchema,
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
 * The two are not interchangeable downstream — the emitted event takes its
 * `tenantId` from the command envelope and its `aggregateId` from
 * `organizationId` — so a caller that wired them to different values would
 * persist the event under one tenant's stream and fold it into a different
 * organization's projection. Nothing later in the pipeline can detect that,
 * which is why it is refused at the wire boundary.
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

export const attachGrantsCommandDataSchema = commandDataSchema({
  grants: z.array(attachGrantEntrySchema).min(1),
});
export type AttachGrantsCommandData = z.infer<
  typeof attachGrantsCommandDataSchema
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
 * One revocation: a grant id, an identity selector, or both.
 *
 * The selector is what makes a revoke-by-filter honest. Its ids come from the
 * compat projection, which lags the ledger by a fold, so a grant appended a
 * moment earlier is missing from the list; carrying the identity lets the fold
 * sweep it (see `grantRevocationSelectorSchema`). A revocation naming neither
 * is a no-op the caller cannot have meant, so the wire refuses it.
 */
export const revokeGrantEntrySchema = z
  .object({
    grantId: z.string().min(1).optional(),
    selector: grantRevocationSelectorSchema.optional(),
    reason: z.string().min(1).optional(),
  })
  .refine(
    (entry) => entry.grantId !== undefined || entry.selector !== undefined,
    {
      message:
        "a revocation names a grant id, an identity selector, or both — never neither",
      path: ["grantId"],
    },
  );
export type RevokeGrantEntry = z.infer<typeof revokeGrantEntrySchema>;

export const revokeGrantsCommandDataSchema = commandDataSchema({
  revocations: z.array(revokeGrantEntrySchema).min(1),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type RevokeGrantsCommandData = z.infer<
  typeof revokeGrantsCommandDataSchema
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

export const defineRolesCommandDataSchema = commandDataSchema({
  roles: z.array(defineRoleEntrySchema).min(1),
  actor: grantsLedgerActorSchema,
});
export type DefineRolesCommandData = z.infer<
  typeof defineRolesCommandDataSchema
>;

export const deleteRoleCommandDataSchema = commandDataSchema({
  roleId: z.string().min(1),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type DeleteRoleCommandData = z.infer<typeof deleteRoleCommandDataSchema>;

export const offboardMemberCommandDataSchema = commandDataSchema({
  userId: z.string().min(1),
  /** What the writer could see. The fold sweeps by principal, so an
   *  incomplete list cannot leave the member holding access. */
  revokedGrantIds: z.array(z.string().min(1)),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type OffboardMemberCommandData = z.infer<
  typeof offboardMemberCommandDataSchema
>;

export const proveMigrationParityCommandDataSchema = commandDataSchema({
  diffs: z.array(z.string().min(1)),
  occurredAtMs: z.number().int().nonnegative(),
});
export type ProveMigrationParityCommandData = z.infer<
  typeof proveMigrationParityCommandDataSchema
>;

export const completeCutoverCommandDataSchema = commandDataSchema({
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type CompleteCutoverCommandData = z.infer<
  typeof completeCutoverCommandDataSchema
>;

export const rollBackCutoverCommandDataSchema = commandDataSchema({
  actor: grantsLedgerActorSchema,
  reason: z.string().min(1).optional(),
  occurredAtMs: z.number().int().nonnegative(),
});
export type RollBackCutoverCommandData = z.infer<
  typeof rollBackCutoverCommandDataSchema
>;

export const recordMigrationTenantStateCommandDataSchema = commandDataSchema({
  migrationName: z.string().min(1),
  status: migrationTenantStatusSchema,
  report: z.unknown().nullish(),
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type RecordMigrationTenantStateCommandData = z.infer<
  typeof recordMigrationTenantStateCommandDataSchema
>;
