import { z } from "zod";

/**
 * What an administrator hands over to register their identity provider (D09).
 * Two protocols and one shape each, discriminated rather than a bag of
 * optional fields, because half the combinations are nonsense.
 */

export const ssoOidcRegistrationSchema = z.object({
  protocol: z.literal("oidc"),
  /** The address the discovery document lives under. */
  issuer: z.string().trim().min(1).max(2048),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().min(1).max(4096),
});

export const ssoSamlRegistrationSchema = z.object({
  protocol: z.literal("saml"),
  /** Where a sign-in request is sent. */
  entryPoint: z.string().trim().min(1).max(2048),
  /** What the provider calls itself. Derivable from metadata, so either this
   *  or `metadataXml` has to be there and neither alone is required. */
  entityId: z.string().trim().max(2048).nullable().default(null),
  metadataXml: z.string().max(512_000).nullable().default(null),
  certificate: z.string().max(64_000).nullable().default(null),
});

export const ssoIdpRegistrationSchema = z.discriminatedUnion("protocol", [
  ssoOidcRegistrationSchema,
  ssoSamlRegistrationSchema,
]);

export type SsoOidcRegistration = z.infer<typeof ssoOidcRegistrationSchema>;
export type SsoSamlRegistration = z.infer<typeof ssoSamlRegistrationSchema>;
export type SsoIdpRegistration = z.infer<typeof ssoIdpRegistrationSchema>;

/**
 * The SAML configuration as one document, which is what the vault holds under
 * a single reference and what a provider row is rebuilt from.
 */
export const ssoSamlIdpConfigSchema = z.object({
  entryPoint: z.string().min(1),
  entityId: z.string().nullable(),
  metadataXml: z.string().nullable(),
  certificate: z.string().nullable(),
});
export type SsoSamlIdpConfig = z.infer<typeof ssoSamlIdpConfigSchema>;

/** The stored document, or null when the reference held something else. */
export function parseSamlIdpConfig(raw: string): SsoSamlIdpConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return ssoSamlIdpConfigSchema.parse(parsed);
  } catch {
    return null;
  }
}
