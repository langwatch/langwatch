import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * A sign-in an identity provider refused (`access_denied`), as identity classifies it for the
 * auth door: which organization the connection belongs to, what kind of provider it is, and
 * whether the organization has run out of seats for the person.
 * @see specs/identity/idp-refused-sign-in.feature
 */

/** The provider kinds a refusal may name on the sign-in error screen. Anything else is unnamed. */
export const SIGN_IN_IDP_KINDS = [
  "okta",
  "entra",
  "google",
  "onelogin",
  "jumpcloud",
  "ping",
  "auth0",
  "oidc",
  "saml",
] as const;

export const signInIdpKindSchema = z.enum(SIGN_IN_IDP_KINDS);
export type SignInIdpKind = z.infer<typeof signInIdpKindSchema>;

/** The admitted kind a caller-controlled value names, or undefined when it names none. */
export function parseSignInIdpKind(value: string | null | undefined): SignInIdpKind | undefined {
  const parsed = signInIdpKindSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** What turned the person away: an organization's connection, or an installation provider. */
const refusedSignInSourceSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connection"), connectionId: z.string().min(1) }),
  z.object({ kind: z.literal("provider"), providerId: z.string().min(1) }),
]);
export interface RefusedSignInSourceSchema extends Named<
  typeof refusedSignInSourceSchemaDefinition
> {}
export const refusedSignInSourceSchema: RefusedSignInSourceSchema =
  refusedSignInSourceSchemaDefinition;
export type RefusedSignInSource = z.infer<typeof refusedSignInSourceSchema>;

const refusedSignInInputSchemaDefinition = z.object({
  refusedBy: refusedSignInSourceSchema,
  /** The address typed on the sign-in page, read from the signed hint; null when none is known. */
  email: z.string().nullable(),
});
export interface RefusedSignInInputSchema extends Named<
  typeof refusedSignInInputSchemaDefinition
> {}
export const refusedSignInInputSchema: RefusedSignInInputSchema =
  refusedSignInInputSchemaDefinition;
export type RefusedSignInInput = z.infer<typeof refusedSignInInputSchema>;

/** `seat_limit`: the organization would hold this person for want of a seat. */
export const REFUSED_SIGN_IN_OUTCOMES = ["seat_limit", "refused"] as const;

const refusedSignInClassificationSchemaDefinition = z.object({
  organizationId: z.string().nullable(),
  idp: signInIdpKindSchema.nullable(),
  outcome: z.enum(REFUSED_SIGN_IN_OUTCOMES),
});
export interface RefusedSignInClassificationSchema extends Named<
  typeof refusedSignInClassificationSchemaDefinition
> {}
export const refusedSignInClassificationSchema: RefusedSignInClassificationSchema =
  refusedSignInClassificationSchemaDefinition;
export type RefusedSignInClassification = z.infer<typeof refusedSignInClassificationSchema>;
