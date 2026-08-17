import { z } from "zod";
import {
  grantEventSourceSchema,
  grantsLedgerActorSchema,
  ledgerPrincipalSchema,
  ledgerScopeSchema,
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

export const attachGrantEntrySchema = z.object({
  grantId: z.string().min(1),
  principal: ledgerPrincipalSchema,
  roleKey: z.string().nullable(),
  scope: ledgerScopeSchema,
  resource: resourceGrantTermsSchema.optional(),
  source: grantEventSourceSchema,
  actor: grantsLedgerActorSchema,
  /** Business time of the fact — a backfilled grant carries the legacy
   *  row's createdAt; it becomes the emitted event's `occurredAt`. */
  occurredAtMs: z.number().int().nonnegative(),
});
export type AttachGrantEntry = z.infer<typeof attachGrantEntrySchema>;

export const attachGrantsCommandDataSchema = commandIdentitySchema.extend({
  grants: z.array(attachGrantEntrySchema).min(1),
});
export type AttachGrantsCommandData = z.infer<
  typeof attachGrantsCommandDataSchema
>;

export const proveMigrationParityCommandDataSchema =
  commandIdentitySchema.extend({
    diffs: z.array(z.string()),
    occurredAtMs: z.number().int().nonnegative(),
  });
export type ProveMigrationParityCommandData = z.infer<
  typeof proveMigrationParityCommandDataSchema
>;

export const completeCutoverCommandDataSchema = commandIdentitySchema.extend({
  actor: grantsLedgerActorSchema,
  occurredAtMs: z.number().int().nonnegative(),
});
export type CompleteCutoverCommandData = z.infer<
  typeof completeCutoverCommandDataSchema
>;

export const rollBackCutoverCommandDataSchema = commandIdentitySchema.extend({
  actor: grantsLedgerActorSchema,
  reason: z.string().optional(),
  occurredAtMs: z.number().int().nonnegative(),
});
export type RollBackCutoverCommandData = z.infer<
  typeof rollBackCutoverCommandDataSchema
>;
