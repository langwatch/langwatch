import { z } from "zod";

/**
 * The command block every identity command carries, and the invariant that
 * makes it one history per person.
 *
 * Its own module because both `facts.ts` and `mfa.ts` need it, and `facts.ts`
 * composes `mfa.ts`'s payloads into the fact vocabulary — importing the
 * helper the other way round would close a cycle between them.
 */
const commandIdentitySchema = z.object({
  /** The user IS the tenant of their own identity history (ADR-029 §4);
   *  the framework builds the command envelope's tenantId from this field. */
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  commandId: z.string().min(1),
});

/**
 * Every identity command carries the identity block AND the invariant:
 * `tenantId === userId`. The emitted fact takes its `tenantId` from the
 * command envelope and its `aggregateId` from `userId` — a caller wiring
 * them differently would persist the event under one tenant's stream and
 * fold it into another user's projection, which nothing downstream can
 * detect. Refused at the wire boundary instead.
 *
 * Shared with two-step verification, which is the same shape of aggregate —
 * one history per person, the person as the tenant — and needs the invariant
 * for the same reason. Two copies of a refinement is two ways for it to
 * drift.
 */
export function userTenantedCommandSchema<Shape extends z.ZodRawShape>(
  shape: Shape,
) {
  return commandIdentitySchema
    .extend(shape)
    .refine((data) => data.tenantId === data.userId, {
      message: "tenantId must equal userId: one identity history per user",
      path: ["tenantId"],
    });
}
