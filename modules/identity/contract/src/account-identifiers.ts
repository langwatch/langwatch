import type { Named } from "@langwatch/module";
/** The account's own sign-in addresses (D01).
 *  Spec: specs/identity/authentication-settings.feature */
import { z } from "zod";

import { identifierProviderSchema } from "./vocabulary.ts";

/** One row of the authentication settings page's address list. */
const accountIdentifierSchemaDefinition = z
  .object({
    identifierId: z.string(),
    /** The better-auth `Account` row this mirrors, where one exists. */
    accountId: z.string().nullable(),
    provider: identifierProviderSchema,
    /** The address, or the provider's own name for a federated identifier. */
    value: z.string().nullable(),
    isPrimary: z.boolean(),
    confirmed: z.boolean(),
    resendable: z.boolean(),
    removable: z.boolean(),
    /** The detach guard's refusal code; the words come from the presentation registry. */
    refusalCode: z.string().nullable(),
    demotesFirst: z.boolean(),
  })
  .strict();
export interface AccountIdentifierSchema extends Named<typeof accountIdentifierSchemaDefinition> {}
export const accountIdentifierSchema: AccountIdentifierSchema = accountIdentifierSchemaDefinition;
export type AccountIdentifier = z.infer<typeof accountIdentifierSchema>;

/** RFC 7636 §4.2: the S256 challenge, base64url of a SHA-256 digest (43 characters, no padding). */
export const identifierCodeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const emailIdentifierAddedSchemaDefinition = z.object({ identifierId: z.string() }).strict();
export interface EmailIdentifierAddedSchema extends Named<
  typeof emailIdentifierAddedSchemaDefinition
> {}
export const emailIdentifierAddedSchema: EmailIdentifierAddedSchema =
  emailIdentifierAddedSchemaDefinition;
export type EmailIdentifierAdded = z.infer<typeof emailIdentifierAddedSchema>;

/** When each sign-in method last minted a session, and the newest second-factor sign-in. */
const methodsLastUsedSchemaDefinition = z
  .object({
    byIdentifier: z.record(z.string(), z.string()),
    secondFactorAt: z.string().nullable(),
  })
  .strict();
export interface MethodsLastUsedSchema extends Named<typeof methodsLastUsedSchemaDefinition> {}
export const methodsLastUsedSchema: MethodsLastUsedSchema = methodsLastUsedSchemaDefinition;
export type MethodsLastUsed = z.infer<typeof methodsLastUsedSchema>;
