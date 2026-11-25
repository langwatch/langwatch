import type { Named } from "@langwatch/module";
import { z } from "zod";

/** A sign-in method as a fixed code, never a provider's configured id. */
export const userSignInMethodSchema = z.enum([
  "password",
  "google",
  "github",
  "gitlab",
  "microsoft",
  "sso",
]);
export type UserSignInMethod = z.infer<typeof userSignInMethodSchema>;

/**
 * One account behind an address as a staff investigation reads it (ADR-202, ops functions):
 * ids, codes, flags and epoch-millisecond times. Never a name, an address or a credential.
 */
const userSignInAccountSchemaDefinition = z
  .object({
    userId: z.string(),
    createdAt: z.number().int().nonnegative(),
    lastSignInAt: z.number().int().nonnegative().nullable(),
    methods: z.array(userSignInMethodSchema),
    twoStepEnabled: z.boolean(),
    deactivated: z.boolean(),
  })
  .strict();
export interface UserSignInAccountSchema extends Named<typeof userSignInAccountSchemaDefinition> {}
export const userSignInAccountSchema: UserSignInAccountSchema = userSignInAccountSchemaDefinition;
export type UserSignInAccount = z.infer<typeof userSignInAccountSchema>;
