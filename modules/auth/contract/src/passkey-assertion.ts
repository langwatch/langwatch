/** A passkey signature over one caller-chosen challenge, with user verification required. */

import type { Named } from "@langwatch/module";
import { z } from "zod";

const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, "base64url without padding");

/** Why an assertion was refused, carried in the refusal's `meta.reason`. */
export const passkeyAssertionRefusalReasons = [
  "unknown_credential",
  "user_verification_missing",
  "bad_signature",
  "wrong_user",
] as const;
export type PasskeyAssertionRefusalReason = (typeof passkeyAssertionRefusalReasons)[number];

/** The challenge a caller binds the signature to: base64url bytes, at least 16 of them. */
const passkeyAssertionChallengeSchemaDefinition = base64UrlSchema.min(22);
export interface PasskeyAssertionChallengeSchema extends Named<
  typeof passkeyAssertionChallengeSchemaDefinition
> {}
export const passkeyAssertionChallengeSchema: PasskeyAssertionChallengeSchema =
  passkeyAssertionChallengeSchemaDefinition;

/**
 * `PublicKeyCredentialRequestOptionsJSON`, what `@simplewebauthn/browser`'s
 * `startAuthentication({ optionsJSON })` takes as it is.
 */
const passkeyAssertionOptionsSchemaDefinition = z.object({
  challenge: passkeyAssertionChallengeSchema,
  rpId: z.string().min(1),
  timeout: z.number().int().positive(),
  userVerification: z.literal("required"),
  allowCredentials: z.array(
    z.object({
      id: base64UrlSchema,
      type: z.literal("public-key"),
      transports: z.array(z.string()).optional(),
    }),
  ),
});
export interface PasskeyAssertionOptionsSchema extends Named<
  typeof passkeyAssertionOptionsSchemaDefinition
> {}
export const passkeyAssertionOptionsSchema: PasskeyAssertionOptionsSchema =
  passkeyAssertionOptionsSchemaDefinition;
export type PasskeyAssertionOptions = z.infer<typeof passkeyAssertionOptionsSchema>;

/** `AuthenticationResponseJSON`, what `startAuthentication` resolves with. */
const passkeyAssertionResponseSchemaDefinition = z.object({
  id: base64UrlSchema,
  rawId: base64UrlSchema,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64UrlSchema,
    authenticatorData: base64UrlSchema,
    signature: base64UrlSchema,
    userHandle: base64UrlSchema.optional(),
  }),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});
export interface PasskeyAssertionResponseSchema extends Named<
  typeof passkeyAssertionResponseSchemaDefinition
> {}
export const passkeyAssertionResponseSchema: PasskeyAssertionResponseSchema =
  passkeyAssertionResponseSchemaDefinition;
export type PasskeyAssertionResponse = z.infer<typeof passkeyAssertionResponseSchema>;
