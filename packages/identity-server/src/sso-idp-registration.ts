import {
  SsoCertificateInvalidError,
  SsoCredentialsRequiredError,
  SsoIssuerUnreachableError,
  SsoSamlMetadataInvalidError,
} from "@langwatch/identity";
import { z } from "zod";

/**
 * What an administrator hands over to register their identity provider, and
 * what is checked before a single fact is written (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * Two protocols and one shape each, discriminated rather than a bag of
 * optional fields: "an OpenID Connect provider with no client secret" and "a
 * SAML provider with a client secret" are both nonsense, and a union says so
 * at the type level instead of in a guard.
 *
 * Everything here runs at COMMAND time, never in the fold. Reaching an
 * issuer is a network call and parsing metadata can fail, and neither belongs
 * in a projection that has to rebuild the same row on every replay. What the
 * fold sees is a reference to something already checked.
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
  /** What the identity provider calls itself. Derivable from metadata, so
   *  either this or `metadataXml` has to be there and neither alone is
   *  required. */
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
 * Whether an OpenID Connect issuer answers. A port because it is a network
 * call: a unit test says what the world answered instead of arranging for the
 * world to answer it.
 */
export interface SsoIssuerDiscoveryPort {
  discover(args: {
    issuer: string;
  }): Promise<{ reachable: true } | { reachable: false; reason: string }>;
}

/**
 * The SAML configuration as one document, which is what the vault holds under
 * a single reference and what the engine's provider row is rebuilt from.
 */
export interface SsoSamlIdpConfig {
  entryPoint: string;
  entityId: string | null;
  metadataXml: string | null;
  certificate: string | null;
}

export function parseSamlIdpConfig(raw: string): SsoSamlIdpConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return samlIdpConfigSchema.parse(parsed);
  } catch {
    return null;
  }
}

const samlIdpConfigSchema = z.object({
  entryPoint: z.string().min(1),
  entityId: z.string().nullable(),
  metadataXml: z.string().nullable(),
  certificate: z.string().nullable(),
});

/**
 * Check a SAML registration and answer the document to keep.
 *
 * Order matters and is the order the reader will fix things in: what is
 * MISSING first, then what is unreadable. Telling somebody their certificate
 * is malformed when they never pasted one sends them to the wrong screen.
 */
export function validateSamlRegistration(
  registration: SsoSamlRegistration,
): SsoSamlIdpConfig {
  const metadataXml = blankToNull(registration.metadataXml);
  const certificate = blankToNull(registration.certificate);
  const entityId = blankToNull(registration.entityId);

  if (metadataXml === null && (entityId === null || certificate === null)) {
    throw new SsoCredentialsRequiredError(
      "a saml registration needs identity provider metadata, or an entity id and a signing certificate",
    );
  }
  if (metadataXml !== null && !looksLikeSamlDescriptor(metadataXml)) {
    throw new SsoSamlMetadataInvalidError(
      "the supplied document is not a saml identity provider descriptor",
    );
  }
  if (certificate !== null && !looksLikeCertificate(certificate)) {
    throw new SsoCertificateInvalidError(
      "the supplied signing certificate could not be read",
    );
  }
  return {
    entryPoint: registration.entryPoint,
    entityId,
    metadataXml,
    certificate,
  };
}

/**
 * Check an OpenID Connect registration by asking the issuer whether it is
 * one. The client id and secret are checked for presence only — whether they
 * are the RIGHT ones is a question only a sign-in can answer, and pretending
 * otherwise would mean a test sign-in that proves nothing.
 */
export async function validateOidcRegistration({
  registration,
  discovery,
}: {
  registration: SsoOidcRegistration;
  discovery: SsoIssuerDiscoveryPort;
}): Promise<void> {
  if (
    blankToNull(registration.clientId) === null ||
    blankToNull(registration.clientSecret) === null
  ) {
    throw new SsoCredentialsRequiredError(
      "an openid connect registration needs a client id and a client secret",
    );
  }
  const answer = await discovery.discover({ issuer: registration.issuer });
  if (!answer.reachable) {
    throw new SsoIssuerUnreachableError(
      `discovery at ${registration.issuer} did not answer: ${answer.reason}`,
    );
  }
}

/**
 * Where the discovery document lives, from the issuer.
 *
 * The spelling is the specification's: the well-known path is appended to the
 * issuer INCLUDING any path it already carries, which is what makes a
 * multi-tenant issuer like `https://login.example.com/t/acme` discoverable at
 * all. A trailing slash is dropped so the same issuer typed two ways resolves
 * to one address.
 */
export function discoveryEndpointFor({ issuer }: { issuer: string }): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

/**
 * A descriptor names itself, and either shape is legitimate: an
 * `EntityDescriptor` wrapping one, or an `EntitiesDescriptor` holding
 * several. What must be there is the identity provider role — a document
 * describing only a service provider is somebody's own metadata pasted into
 * the wrong box, which is the mistake this catches.
 */
function looksLikeSamlDescriptor(xml: string): boolean {
  return (
    /<(?:[A-Za-z0-9._-]+:)?Entit(?:y|ies)Descriptor[\s>]/.test(xml) &&
    /<(?:[A-Za-z0-9._-]+:)?IDPSSODescriptor[\s>]/.test(xml)
  );
}

/**
 * A certificate is base64 that decodes to a DER SEQUENCE. Both the armoured
 * and the bare form are accepted because identity providers hand out both,
 * and an administrator copying the body out of a metadata document has the
 * bare one.
 *
 * This proves the bytes are readable and nothing else. Whether the key inside
 * signs the assertions is the engine's question at sign-in, and it is the
 * only thing that could answer it.
 */
function looksLikeCertificate(certificate: string): boolean {
  const body = certificate
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  if (body.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return false;
  try {
    const der = Buffer.from(body, "base64");
    return der.length >= 64 && der[0] === 0x30;
  } catch {
    return false;
  }
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
