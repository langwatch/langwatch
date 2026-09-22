import {
  SsoCertificateInvalidError,
  SsoCredentialsRequiredError,
  SsoIssuerUnreachableError,
  type SsoOidcRegistration,
  type SsoSamlIdpConfig,
  type SsoSamlRegistration,
  SsoSamlMetadataInvalidError,
} from "@langwatch/identity-contract";
import { Extractor } from "samlify";
import { z } from "zod";

import type { SsoIssuerDiscoveryChannel } from "../channels/sso-issuer-discovery.channel.ts";
import {
  looksLikeCertificate,
  looksLikeSamlDescriptor,
  trimmedText,
} from "../rules/sso-idp-registration.rules.ts";

export interface SsoIdpRegistrationServiceDeps {
  discovery: SsoIssuerDiscoveryChannel;
}

/**
 * What is checked before a registration writes a fact (D09). All of it runs
 * at COMMAND time: reaching an issuer is a network call and parsing metadata
 * can fail, and neither belongs in a projection that replays.
 */
export class SsoIdpRegistrationService {
  static create(deps: SsoIdpRegistrationServiceDeps): SsoIdpRegistrationService {
    return new SsoIdpRegistrationService(deps);
  }

  private constructor(private readonly deps: SsoIdpRegistrationServiceDeps) {}

  /** Checks an OpenID Connect registration by asking the issuer whether it is
   *  one. The credentials are checked for presence only: whether they are the
   *  RIGHT ones is a question only a sign-in can answer. */
  async validateOidcRegistration(registration: SsoOidcRegistration): Promise<void> {
    if (
      trimmedText(registration.clientId) === "" ||
      trimmedText(registration.clientSecret) === ""
    ) {
      throw new SsoCredentialsRequiredError(
        "an openid connect registration needs a client id and a client secret",
      );
    }

    const answer = await this.deps.discovery.discover({ issuer: registration.issuer });
    if (!answer.reachable) {
      throw new SsoIssuerUnreachableError(
        `discovery at ${registration.issuer} did not answer: ${answer.reason}`,
      );
    }
  }

  /** Checks a SAML registration and answers the document to keep. What is
   *  MISSING is named before what is unreadable: a certificate nobody pasted
   *  reported as malformed sends the reader to the wrong screen. */
  validateSamlRegistration(registration: SsoSamlRegistration): SsoSamlIdpConfig {
    const metadataXml = trimmedText(registration.metadataXml);
    const certificate = trimmedText(registration.certificate);
    const entityId = trimmedText(registration.entityId);

    if (metadataXml === "" && (entityId === "" || certificate === "")) {
      throw new SsoCredentialsRequiredError(
        "a saml registration needs identity provider metadata, or an entity id and a signing certificate",
      );
    }
    if (metadataXml !== "" && !looksLikeSamlDescriptor(metadataXml)) {
      throw new SsoSamlMetadataInvalidError(
        "the supplied document is not a saml identity provider descriptor",
      );
    }
    if (metadataXml !== "" && certificate === "" && !hasSigningCertificate(metadataXml)) {
      throw new SsoSamlMetadataInvalidError(
        "the identity provider metadata must contain a readable signing certificate",
      );
    }
    if (certificate !== "" && !looksLikeCertificate(certificate)) {
      throw new SsoCertificateInvalidError("the supplied signing certificate could not be read");
    }

    // The stored shape's absence, produced once, where the document is built.
    return {
      entryPoint: registration.entryPoint,
      entityId: entityId === "" ? null : entityId,
      metadataXml: metadataXml === "" ? null : metadataXml,
      certificate: certificate === "" ? null : certificate,
    };
  }
}

const extractedTextSchema = z.union([z.string(), z.array(z.string())]);

/** Whether the descriptor carries a signing key whose bytes are readable. */
function hasSigningCertificate(metadata: string): boolean {
  try {
    const descriptors = Extractor.extract(metadata, [
      {
        key: "keys",
        localPath: ["EntityDescriptor", "IDPSSODescriptor", "KeyDescriptor"],
        attributes: [],
        context: true,
      },
    ]).keys;
    const candidates = extractedTextSchema.parse(descriptors);
    const keys = Array.isArray(candidates) ? candidates : [candidates];

    return keys.some(keyCarriesSigningCertificate);
  } catch {
    return false;
  }
}

/** One `KeyDescriptor`: a signing use, and a certificate that decodes. */
function keyCarriesSigningCertificate(key: string): boolean {
  const extracted = Extractor.extract(key, [
    { key: "use", localPath: ["KeyDescriptor"], attributes: ["use"] },
    {
      key: "certificate",
      localPath: ["KeyDescriptor", "KeyInfo", "X509Data", "X509Certificate"],
      attributes: [],
    },
  ]);
  if (extracted.use && extracted.use !== "signing") return false;

  const parsed = extractedTextSchema.safeParse(extracted.certificate);
  if (!parsed.success) return false;
  const certificates = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  return certificates.some(looksLikeCertificate);
}
