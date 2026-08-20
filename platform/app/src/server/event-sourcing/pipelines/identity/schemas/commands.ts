import { z } from "zod";
import {
  identifierProviderSchema,
  identityActorSchema,
  verificationMethodSchema,
} from "./events";

/**
 * Command payloads for the identity pipeline (ADR-101, D01).
 *
 * Every command carries a caller-minted `commandId`: the caller mints it
 * once, retries reuse it, and each emitted event's `idempotencyKey` is
 * `<commandId>:<index>` — a retried command dedupes at the event store
 * while a legitimately repeated action never can. The backfill derives its
 * commandIds deterministically from source rows (`backfill:<accountId>`);
 * ceremony paths mint a random KSUID.
 *
 * PII rides here transiently — commands are dispatched and processed, never
 * durably stored — and the RAW identifier value rides only on the command:
 * the handler normalizes it, and only the normalized form ever reaches an
 * event.
 */

const commandIdentitySchema = z.object({
  /** The user IS the tenant of their own identity history (ADR-029 §4);
   *  the framework builds the command envelope's tenantId from this field. */
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  commandId: z.string().min(1),
});

/**
 * Every identity command carries the identity block AND the invariant that
 * makes it one history per user: `tenantId === userId`. The emitted event
 * takes its `tenantId` from the command envelope and its `aggregateId` from
 * `userId` — a caller wiring them differently would persist the event under
 * one tenant's stream and fold it into another user's projection, which
 * nothing downstream can detect. Refused at the wire boundary instead.
 */
function commandDataSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return commandIdentitySchema
    .extend(shape)
    .refine((data) => data.tenantId === data.userId, {
      message: "tenantId must equal userId: one identity history per user",
      path: ["tenantId"],
    });
}

export const attachIdentifierCommandDataSchema = commandDataSchema({
  /** The better-auth protocol row, when one exists. */
  accountId: z.string().min(1).nullable(),
  provider: identifierProviderSchema,
  /** The provider's own account id (OAuth `providerAccountId`) — part of
   *  the identifier's deterministic identity when present. */
  providerAccountId: z.string().min(1).nullable(),
  /** RAW value as the ceremony delivered it — normalized by the handler,
   *  never stored in an event un-normalized. */
  value: z.string().min(1),
  /** Business time of the fact; a backfilled identifier carries the legacy
   *  row's createdAt. Becomes the event's `occurredAt` and the timestamp
   *  bits of the deterministic identifier id. */
  occurredAtMs: z.number().int().nonnegative(),
  ceremony: z.object({
    flow: z.string().min(1),
    requestId: z.string().min(1).optional(),
  }),
  actor: identityActorSchema,
});
export type AttachIdentifierCommandData = z.infer<
  typeof attachIdentifierCommandDataSchema
>;

export const verifyIdentifierCommandDataSchema = commandDataSchema({
  identifierId: z.string().min(1),
  /** The consumed Verification record (magic-link ceremonies). */
  verificationId: z.string().min(1).nullable(),
  method: verificationMethodSchema,
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type VerifyIdentifierCommandData = z.infer<
  typeof verifyIdentifierCommandDataSchema
>;

export const markPrimaryCommandDataSchema = commandDataSchema({
  identifierId: z.string().min(1),
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type MarkPrimaryCommandData = z.infer<
  typeof markPrimaryCommandDataSchema
>;

export const detachIdentifierCommandDataSchema = commandDataSchema({
  identifierId: z.string().min(1),
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type DetachIdentifierCommandData = z.infer<
  typeof detachIdentifierCommandDataSchema
>;

export const eraseUserCommandDataSchema = commandDataSchema({
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});
export type EraseUserCommandData = z.infer<typeof eraseUserCommandDataSchema>;
