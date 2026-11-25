import type { Named } from "@langwatch/module";
import { userSignInMethodSchema } from "@langwatch/user-contract";
import { z } from "zod";

/** A way into an account as a fixed code: a linked method, or a registered passkey. */
export const signInFactsMethodSchema = z.enum([...userSignInMethodSchema.options, "passkey"]);
export type SignInFactsMethod = z.infer<typeof signInFactsMethodSchema>;

/**
 * One account behind an address as a staff investigation reads it (ADR-202, ops functions):
 * ids, method codes, counts, flags and epoch-millisecond times. Never the address back, a name,
 * a password hash, a second-step secret or a session token.
 */
const signInFactsSchemaDefinition = z
  .object({
    userId: z.string(),
    createdAt: z.number().int().nonnegative(),
    lastSignInAt: z.number().int().nonnegative().nullable(),
    methods: z.array(signInFactsMethodSchema),
    passkeys: z.number().int().nonnegative(),
    twoStepEnabled: z.boolean(),
    locked: z.boolean(),
    deactivated: z.boolean(),
  })
  .strict();
export interface SignInFactsSchema extends Named<typeof signInFactsSchemaDefinition> {}
export const signInFactsSchema: SignInFactsSchema = signInFactsSchemaDefinition;
export type SignInFacts = z.infer<typeof signInFactsSchema>;
