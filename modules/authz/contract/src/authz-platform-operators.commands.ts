import { ledgerActorSchema } from "@langwatch/authorization";
/**
 * The platform tier's three operations (ARCHITECTURE.md, "Platform operators are a grant"):
 * grant, revoke and list the platform-operator role. Never on an organization's grant doors.
 */
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import { grantEventSourceSchema, ledgerPrincipalSchema } from "./authz-grant.events.ts";
import { authzGrantCallerSchema } from "./authz.commands.ts";

/** The revoke reason user erasure writes; with a `system` caller it may remove the last holder. */
export const PLATFORM_GRANT_ERASURE_REASON = "user-erased" as const;

/** One live platform-operator grant: who holds it, and since when. */
export const platformOperatorSchema = z
  .object({
    grantId: z.string().min(1),
    userId: z.string().min(1),
    grantedAt: z.instanceof(Temporal.Instant),
  })
  .strict();
export type PlatformOperator = z.infer<typeof platformOperatorSchema>;

export const authzGrantPlatformOperatorInputSchema = z
  .object({
    /** Users only; any other principal is refused. */
    principal: ledgerPrincipalSchema,
    /** A holder of `ops:manage`, or `system` for the seed, bootstrap and recovery task. */
    caller: authzGrantCallerSchema,
    actor: ledgerActorSchema,
    source: grantEventSourceSchema.optional(),
    /** A deterministic id (`deriveGrantId`) for a writer that may run twice. */
    grantId: z.string().min(1).optional(),
  })
  .strict();
export type AuthzGrantPlatformOperatorInput = z.infer<typeof authzGrantPlatformOperatorInputSchema>;
export const authzGrantPlatformOperatorOutputSchema = platformOperatorSchema;

export const authzRevokePlatformOperatorInputSchema = z
  .object({
    grantId: z.string().min(1),
    caller: authzGrantCallerSchema,
    actor: ledgerActorSchema,
    /** `user-erased` with a `system` caller is the only revoke that may remove the last holder. */
    reason: z.string().min(1).optional(),
  })
  .strict();
export type AuthzRevokePlatformOperatorInput = z.infer<
  typeof authzRevokePlatformOperatorInputSchema
>;

/** Every live holder, oldest first. */
export const authzListPlatformOperatorsOutputSchema = z.array(platformOperatorSchema);
export type AuthzListPlatformOperatorsOutput = z.infer<
  typeof authzListPlatformOperatorsOutputSchema
>;
