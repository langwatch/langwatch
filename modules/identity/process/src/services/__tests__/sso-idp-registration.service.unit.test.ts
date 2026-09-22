/**
 * @vitest-environment node
 * What a registration is checked for before a single fact is written (D09).
 * @see specs/identity/sso-idp-termination.feature
 */
import type { SsoSamlRegistration } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import type { SsoIssuerDiscoveryChannel } from "../../channels/sso-issuer-discovery.channel.ts";
import { discoveryEndpointFor } from "../../rules/sso-idp-registration.rules.ts";
import { SsoIdpRegistrationService } from "../sso-idp-registration.service.ts";

/** A real certificate body: a DER SEQUENCE, base64, long enough to be one. */
const CERTIFICATE = Buffer.concat([
  Buffer.from([0x30, 0x82, 0x01, 0x00]),
  Buffer.alloc(252, 0x41),
]).toString("base64");

const IDP_METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://login.acme.example">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${CERTIFICATE}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:SingleSignOnService Location="https://login.acme.example/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

const reachable: SsoIssuerDiscoveryChannel = {
  discover: async () => ({ reachable: true }),
};
const unreachable: SsoIssuerDiscoveryChannel = {
  discover: async () => ({ reachable: false, reason: "host_refused" }),
};

const serviceOver = (discovery: SsoIssuerDiscoveryChannel) =>
  SsoIdpRegistrationService.create({ discovery });

/** The code a refusal carries, or a sentinel when nothing was refused. */
function catchCode(run: () => unknown): string {
  try {
    run();
    return "no refusal";
  } catch (error) {
    return (error as { code?: string }).code ?? "no code";
  }
}

function samlRegistration(over: Partial<SsoSamlRegistration> = {}): SsoSamlRegistration {
  return {
    protocol: "saml",
    entryPoint: "https://login.acme.example/sso",
    entityId: null,
    metadataXml: null,
    certificate: null,
    ...over,
  };
}

describe("registering an OpenID Connect provider", () => {
  /** @scenario "An issuer that cannot be reached is refused in the customer's words" */
  it("refuses an issuer that does not answer, and names the address it asked", async () => {
    await expect(
      serviceOver(unreachable).validateOidcRegistration({
        protocol: "oidc",
        issuer: "https://typo.acme.example",
        clientId: "client",
        clientSecret: "secret",
      }),
    ).rejects.toMatchObject({ code: "sso_issuer_unreachable" });
  });

  /** @scenario "An OpenID Connect registration without a client id is refused before anything is written" */
  it("refuses a registration with a blank client id", async () => {
    await expect(
      serviceOver(reachable).validateOidcRegistration({
        protocol: "oidc",
        issuer: "https://login.acme.okta.com",
        clientId: "   ",
        clientSecret: "secret",
      }),
    ).rejects.toMatchObject({ code: "sso_credentials_required" });
  });

  it("carries an issuer that answers straight through", async () => {
    await expect(
      serviceOver(reachable).validateOidcRegistration({
        protocol: "oidc",
        issuer: "https://login.acme.okta.com",
        clientId: "client",
        clientSecret: "secret",
      }),
    ).resolves.toBeUndefined();
  });

  it("appends the well-known path to whatever path the issuer already carries", () => {
    expect(discoveryEndpointFor({ issuer: "https://login.example.com/t/acme/" })).toBe(
      "https://login.example.com/t/acme/.well-known/openid-configuration",
    );
  });
});

describe("registering a SAML provider", () => {
  const service = serviceOver(reachable);

  /** @scenario "A SAML provider is registered from the identity provider's metadata" */
  it("keeps the metadata a registration supplied", () => {
    const config = service.validateSamlRegistration(
      samlRegistration({ metadataXml: IDP_METADATA }),
    );

    expect(config.metadataXml).toBe(IDP_METADATA);
  });

  /** @scenario "A SAML provider is registered from an entity id and a certificate" */
  it("keeps an entity id and a certificate when there is no metadata", () => {
    const config = service.validateSamlRegistration(
      samlRegistration({ entityId: "https://login.acme.example", certificate: CERTIFICATE }),
    );

    expect(config).toMatchObject({
      entityId: "https://login.acme.example",
      certificate: CERTIFICATE,
    });
  });

  /** @scenario "SAML is no longer refused for being SAML" */
  it("registers a SAML provider without refusing it for its protocol", () => {
    // The refusal this replaces was `sso_saml_not_self_serve`: SAML was turned
    // away for being SAML, whatever it carried.
    expect(() =>
      service.validateSamlRegistration(samlRegistration({ metadataXml: IDP_METADATA })),
    ).not.toThrow();
    expect(() =>
      service.validateSamlRegistration(
        samlRegistration({ entityId: "https://login.acme.example", certificate: CERTIFICATE }),
      ),
    ).not.toThrow();
  });

  /** @scenario "Metadata that is not a SAML descriptor is refused by name" */
  it("refuses a document that describes no identity provider", () => {
    expect(
      catchCode(() =>
        service.validateSamlRegistration(
          samlRegistration({ metadataXml: "<html><body>not metadata</body></html>" }),
        ),
      ),
    ).toBe("sso_saml_metadata_invalid");
  });

  it("refuses a document describing only a service provider", () => {
    expect(
      catchCode(() =>
        service.validateSamlRegistration(
          samlRegistration({
            metadataXml: `<EntityDescriptor entityID="x"><SPSSODescriptor/></EntityDescriptor>`,
          }),
        ),
      ),
    ).toBe("sso_saml_metadata_invalid");
  });

  /** @scenario "Metadata-only SAML registration requires a usable signing certificate" */
  it("refuses metadata whose only signing key cannot be read", () => {
    const unreadable = IDP_METADATA.replace(CERTIFICATE, "not-a-certificate");

    expect(
      catchCode(() =>
        service.validateSamlRegistration(samlRegistration({ metadataXml: unreadable })),
      ),
    ).toBe("sso_saml_metadata_invalid");
  });

  /** @scenario "A certificate that cannot be read is refused by name" */
  it("refuses a certificate that is not one", () => {
    expect(
      catchCode(() =>
        service.validateSamlRegistration(
          samlRegistration({
            entityId: "https://login.acme.example",
            certificate: "-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----",
          }),
        ),
      ),
    ).toBe("sso_certificate_invalid");
  });

  /** @scenario "A SAML registration naming neither metadata nor an entity id is refused" */
  it("refuses a registration that identifies no identity provider", () => {
    expect(catchCode(() => service.validateSamlRegistration(samlRegistration()))).toBe(
      "sso_credentials_required",
    );
  });

  it("names what is missing before it names what is unreadable", () => {
    // A certificate nobody pasted must never be reported as malformed: that
    // sends the reader to the wrong screen.
    expect(
      catchCode(() =>
        service.validateSamlRegistration(
          samlRegistration({ entityId: "https://login.acme.example", certificate: "  " }),
        ),
      ),
    ).toBe("sso_credentials_required");
  });
});
