import type { SsoConnectionState } from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import type { SsoCredentialStore } from "../sso-credential-store";
import {
  connectionIsDialable,
  engineProviderFor,
  serviceProviderDetailsFor,
} from "../sso-engine-provider";
import {
  discoveryEndpointFor,
  type SsoIssuerDiscoveryPort,
  validateOidcRegistration,
  validateSamlRegistration,
} from "../sso-idp-registration";
import { SsoSelfServeService } from "../sso-self-serve.service";

/**
 * Terminating a customer's own identity provider (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * Two halves and one seam between them. The COMMAND half checks what an
 * administrator typed and turns credential values into references; the FOLD
 * half turns a connection's state plus those references back into the row the
 * engine dials from. What is tested here is that the seam holds in both
 * directions: no value crosses into a fact, and no fact is enough on its own
 * to produce a provider.
 */

const BASE_URL = "https://app.langwatch.test";
const ORG = "org_acme";
const CONNECTION = "ssoconn_acme";

/** The vault, in memory. Answers a reference and remembers the value. */
class InMemoryCredentials implements SsoCredentialStore {
  readonly held = new Map<string, { organizationId: string; value: string }>();

  async put({
    organizationId,
    kind,
    value,
  }: Parameters<SsoCredentialStore["put"]>[0]): Promise<string> {
    const ref = `cred_${kind}_${this.held.size}`;
    this.held.set(ref, { organizationId, value });
    return ref;
  }

  async read({
    organizationId,
    ref,
  }: Parameters<SsoCredentialStore["read"]>[0]): Promise<string | null> {
    const record = this.held.get(ref);
    if (record === undefined) return null;
    // Scoped by organization as well as by reference: a reference is an
    // opaque id, and an id being hard to guess is not an access rule.
    return record.organizationId === organizationId ? record.value : null;
  }
}

const reachable: SsoIssuerDiscoveryPort = {
  async discover() {
    return { reachable: true };
  },
};

const unreachable: SsoIssuerDiscoveryPort = {
  async discover() {
    return { reachable: false, reason: "TimeoutError" };
  },
};

/** A real certificate body: a DER SEQUENCE, base64, long enough to be one. */
const CERTIFICATE = Buffer.concat([
  Buffer.from([0x30, 0x82, 0x01, 0x00]),
  Buffer.alloc(252, 0x41),
]).toString("base64");

const IDP_METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://login.acme.example">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:SingleSignOnService Location="https://login.acme.example/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

function connection(
  overrides: Partial<SsoConnectionState> = {},
): SsoConnectionState {
  return {
    connectionId: CONNECTION,
    organizationId: ORG,
    type: "oidc",
    state: "ACTIVE",
    claimedDomains: ["acme.com"],
    domainClaims: [],
    approvedDomains: ["acme.com"],
    verifiedDomains: ["acme.com"],
    domainVerifications: [],
    pendingVerification: null,
    idpMetadata: {
      issuer: "https://login.acme.okta.com",
      providerId: "okta",
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
    arrivalPolicy: "refuse",
    source: "self-serve",
    testLoginAccountId: null,
    rejection: null,
    createdBy: "usr_ana",
    createdAtMs: 0,
    updatedAtMs: 0,
    tearDownAfterMs: null,
    ...overrides,
  } as SsoConnectionState;
}

describe("registering an identity provider", () => {
  let credentials: InMemoryCredentials;

  beforeEach(() => {
    credentials = new InMemoryCredentials();
  });

  describe("when the registration is OpenID Connect", () => {
    /** @scenario "An issuer that cannot be reached is refused in the customer's words" */
    it("refuses an issuer that does not answer, and names the address it asked", async () => {
      const refusal = await validateOidcRegistration({
        registration: {
          protocol: "oidc",
          issuer: "https://typo.acme.example",
          clientId: "client",
          clientSecret: "secret",
        },
        discovery: unreachable,
      })
        .then(() => ({ code: "no refusal" }))
        .catch((error: unknown) => error as { code: string });

      expect(refusal.code).toBe("sso_issuer_unreachable");
    });

    /** @scenario "An OpenID Connect registration without a client id is refused before anything is written" */
    it("refuses a registration with a blank client id", async () => {
      const refusal = await validateOidcRegistration({
        registration: {
          protocol: "oidc",
          issuer: "https://login.acme.okta.com",
          clientId: "   ",
          clientSecret: "secret",
        },
        discovery: reachable,
      })
        .then(() => ({ code: "no refusal" }))
        .catch((error: unknown) => error as { code: string });

      expect(refusal.code).toBe("sso_credentials_required");
    });

    it("appends the well-known path to whatever path the issuer already carries", () => {
      expect(
        discoveryEndpointFor({ issuer: "https://login.example.com/t/acme/" }),
      ).toBe("https://login.example.com/t/acme/.well-known/openid-configuration");
    });
  });

  describe("when the registration is SAML", () => {
    /** @scenario "A SAML provider is registered from the identity provider's metadata" */
    it("keeps the metadata a registration supplied", () => {
      const config = validateSamlRegistration({
        protocol: "saml",
        entryPoint: "https://login.acme.example/sso",
        entityId: null,
        metadataXml: IDP_METADATA,
        certificate: null,
      });

      expect(config.metadataXml).toBe(IDP_METADATA);
    });

    /** @scenario "A SAML provider is registered from an entity id and a certificate" */
    it("keeps an entity id and a certificate when there is no metadata", () => {
      const config = validateSamlRegistration({
        protocol: "saml",
        entryPoint: "https://login.acme.example/sso",
        entityId: "https://login.acme.example",
        metadataXml: null,
        certificate: CERTIFICATE,
      });

      expect(config).toMatchObject({
        entityId: "https://login.acme.example",
        certificate: CERTIFICATE,
      });
    });

    /** @scenario "Metadata that is not a SAML descriptor is refused by name" */
    it("refuses a document that describes no identity provider", () => {
      const refusal = catchCode(() =>
        validateSamlRegistration({
          protocol: "saml",
          entryPoint: "https://login.acme.example/sso",
          entityId: null,
          metadataXml: "<html><body>not metadata</body></html>",
          certificate: null,
        }),
      );

      expect(refusal).toBe("sso_saml_metadata_invalid");
    });

    it("refuses a document describing only a service provider", () => {
      const refusal = catchCode(() =>
        validateSamlRegistration({
          protocol: "saml",
          entryPoint: "https://login.acme.example/sso",
          entityId: null,
          metadataXml: `<EntityDescriptor entityID="x"><SPSSODescriptor/></EntityDescriptor>`,
          certificate: null,
        }),
      );

      expect(refusal).toBe("sso_saml_metadata_invalid");
    });

    /** @scenario "A certificate that cannot be read is refused by name" */
    it("refuses a certificate that is not one", () => {
      const refusal = catchCode(() =>
        validateSamlRegistration({
          protocol: "saml",
          entryPoint: "https://login.acme.example/sso",
          entityId: "https://login.acme.example",
          metadataXml: null,
          certificate: "-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----",
        }),
      );

      expect(refusal).toBe("sso_certificate_invalid");
    });

    /** @scenario "A SAML registration naming neither metadata nor an entity id is refused" */
    it("refuses a registration that identifies no identity provider", () => {
      const refusal = catchCode(() =>
        validateSamlRegistration({
          protocol: "saml",
          entryPoint: "https://login.acme.example/sso",
          entityId: null,
          metadataXml: null,
          certificate: null,
        }),
      );

      expect(refusal).toBe("sso_credentials_required");
    });

    it("names what is missing before it names what is unreadable", () => {
      // A certificate nobody pasted must never be reported as malformed:
      // that sends the reader to the wrong screen.
      const refusal = catchCode(() =>
        validateSamlRegistration({
          protocol: "saml",
          entryPoint: "https://login.acme.example/sso",
          entityId: "https://login.acme.example",
          metadataXml: null,
          certificate: "  ",
        }),
      );

      expect(refusal).toBe("sso_credentials_required");
    });
  });

  describe("when the vault holds a value", () => {
    /** @scenario "A credential belongs to the organization that stored it" */
    it("answers nothing to an organization reading another one's reference", async () => {
      const ref = await credentials.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-secret",
        value: "secret_acme",
      });

      expect(await credentials.read({ organizationId: ORG, ref })).toBe(
        "secret_acme",
      );
      expect(
        await credentials.read({ organizationId: "org_other", ref }),
      ).toBeNull();
    });
  });
});

describe("how many identity providers an organization may register", () => {
  /**
   * The bound, exercised through the service that enforces it.
   *
   * Reached with two stubs rather than the whole harness because what is
   * under test is one question — does the organization already hold a
   * connection — and the answer to it is the only thing this refusal reads.
   */
  const serviceHolding = (held: SsoConnectionState | null) =>
    new SsoSelfServeService({
      connections: () => registeredConnections as never,
      reads: {
        findConnection: async () => null,
        findDomainOwner: async () => null,
        findConnectionForOrganization: async () => held,
      },
      context: {
        resolve: async () => ({
          deployment: "hosted",
          licensed: true,
          licenseActivatedSinceStart: false,
          optedIn: true,
        }),
      },
      proofs: { lookupTxtValues: async () => ({ outcome: "absent" }) },
      files: { fetchVerificationFile: async () => ({ outcome: "absent" }) },
      license: { currentLicenseKey: async () => null },
      credentials: new InMemoryCredentials(),
      discovery: reachable,
      baseUrl: BASE_URL,
      // Not what this refusal reads, so each one answers its quietest.
      testSignIns: { findLatestForConnection: async () => null },
      breakGlass: { history: async () => [] },
      members: {
        findAdministrators: async () => [],
        findByIds: async () => [],
      },
    });

  let registeredConnections: { registerConnection: (data: unknown) => unknown };

  beforeEach(() => {
    registeredConnections = { registerConnection: async () => [] };
  });

  describe("when the organization already holds one", () => {
    /** @scenario "An organization holds one identity provider at a time" */
    it("refuses a second, and states which one it already has", async () => {
      const refusal = await serviceHolding(connection())
        .registerConnection({
          organizationId: ORG,
          providerId: "okta",
          idp: {
            protocol: "oidc",
            issuer: "https://login.acme.okta.com",
            clientId: "client",
            clientSecret: "secret",
          },
          actor: { userId: "usr_ana" },
        })
        .then(() => ({ code: "no refusal" }))
        .catch((error: unknown) => error as { code: string });

      expect(refusal.code).toBe("sso_connection_already_registered");
    });
  });

  describe("when the organization's only connection was discarded", () => {
    /** @scenario "A discarded connection is not one it still holds" */
    it("registers, because a tombstone is not a connection", async () => {
      // `findConnectionForOrganization` answers null for a discarded or
      // torn-down connection, which is what makes setting up again possible
      // after a removal — the refusal reads that port and nothing else.
      const registered = await serviceHolding(null).registerConnection({
        organizationId: ORG,
        providerId: "okta",
        idp: {
          protocol: "oidc",
          issuer: "https://login.acme.okta.com",
          clientId: "client",
          clientSecret: "secret",
        },
        actor: { userId: "usr_ana" },
      });

      expect(registered.connectionId).toEqual(expect.any(String));
    });
  });
});

describe("the engine's provider row", () => {
  let credentials: InMemoryCredentials;

  beforeEach(() => {
    credentials = new InMemoryCredentials();
  });

  describe("when the connection is OpenID Connect and its references resolve", () => {
    /** @scenario "Registering an OpenID Connect provider takes the credentials it will dial with" */
    it("carries the values out of the vault and the discovery address off the issuer", async () => {
      const clientIdRef = await credentials.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-id",
        value: "client_acme",
      });
      const secretRef = await credentials.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-secret",
        value: "secret_acme",
      });

      const row = await engineProviderFor({
        connection: connection({
          idpMetadata: {
            issuer: "https://login.acme.okta.com",
            providerId: "okta",
            clientIdRef,
            secretRef,
            certRefs: [],
          },
        }),
        credentials,
        baseUrl: BASE_URL,
      });

      expect(row).toMatchObject({
        id: CONNECTION,
        // Keyed by the connection, never by the name the customer typed.
        providerId: CONNECTION,
        organizationId: ORG,
        domain: "acme.com",
      });
      expect(JSON.parse(row?.oidcConfig ?? "{}")).toMatchObject({
        clientId: "client_acme",
        clientSecret: "secret_acme",
        discoveryEndpoint:
          "https://login.acme.okta.com/.well-known/openid-configuration",
      });
    });

    /** @scenario "Two organizations may both call their provider okta" */
    it("keys two organizations naming the same provider apart", async () => {
      const rows = await Promise.all(
        ["ssoconn_one", "ssoconn_two"].map(async (connectionId, index) => {
          const organizationId = `org_${index}`;
          const clientIdRef = await credentials.put({
            organizationId,
            connectionId,
            kind: "oidc-client-id",
            value: `client_${index}`,
          });
          const secretRef = await credentials.put({
            organizationId,
            connectionId,
            kind: "oidc-client-secret",
            value: `secret_${index}`,
          });
          return engineProviderFor({
            connection: connection({
              connectionId,
              organizationId,
              idpMetadata: {
                issuer: "https://login.acme.okta.com",
                providerId: "okta",
                clientIdRef,
                secretRef,
                certRefs: [],
              },
            }),
            credentials,
            baseUrl: BASE_URL,
          });
        }),
      );

      expect(rows.map((row) => row?.providerId)).toEqual([
        "ssoconn_one",
        "ssoconn_two",
      ]);
      expect(rows.map((row) => row?.organizationId)).toEqual(["org_0", "org_1"]);
    });
  });

  describe("when the connection is SAML", () => {
    it("rebuilds the dialing configuration from the one stored document", async () => {
      const certRef = await credentials.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "saml-idp-config",
        value: JSON.stringify({
          entryPoint: "https://login.acme.example/sso",
          entityId: "https://login.acme.example",
          metadataXml: IDP_METADATA,
          certificate: null,
        }),
      });

      const row = await engineProviderFor({
        connection: connection({
          type: "saml",
          idpMetadata: {
            issuer: "https://login.acme.example",
            providerId: "okta",
            clientIdRef: null,
            secretRef: null,
            certRefs: [certRef],
          },
        }),
        credentials,
        baseUrl: BASE_URL,
      });

      expect(row?.oidcConfig).toBeNull();
      expect(JSON.parse(row?.samlConfig ?? "{}")).toMatchObject({
        entryPoint: "https://login.acme.example/sso",
        idpMetadata: { metadata: IDP_METADATA },
        // What LangWatch calls itself, stated rather than left to a default
        // that would resolve to nothing.
        spMetadata: { entityID: `${BASE_URL}/api/auth/sso/saml2/sp` },
      });
    });
  });

  describe("when the connection cannot be dialed", () => {
    /** @scenario "A connection the engine has never heard of still refuses to route" */
    it("projects no row for a connection registered without credentials", async () => {
      expect(
        await engineProviderFor({
          connection: connection(),
          credentials,
          baseUrl: BASE_URL,
        }),
      ).toBeNull();
    });

    /** @scenario "A connection whose claim an operator turned down carries nobody" */
    it("projects no row once an operator has rejected its claim", async () => {
      const clientIdRef = await credentials.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-id",
        value: "client_acme",
      });
      const secretRef = await credentials.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-secret",
        value: "secret_acme",
      });

      // A rejection an identity provider could still be dialled through would
      // be a decision about nothing.
      expect(
        await engineProviderFor({
          connection: connection({
            state: "REJECTED",
            idpMetadata: {
              issuer: "https://login.acme.okta.com",
              providerId: "okta",
              clientIdRef,
              secretRef,
              certRefs: [],
            },
          }),
          credentials,
          baseUrl: BASE_URL,
        }),
      ).toBeNull();
    });

    it("projects no row once the connection is suspended", async () => {
      const clientIdRef = await credentials.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-id",
        value: "client_acme",
      });
      const secretRef = await credentials.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-secret",
        value: "secret_acme",
      });

      expect(
        await engineProviderFor({
          connection: connection({
            state: "SUSPENDED",
            idpMetadata: {
              issuer: "https://login.acme.okta.com",
              providerId: "okta",
              clientIdRef,
              secretRef,
              certRefs: [],
            },
          }),
          credentials,
          baseUrl: BASE_URL,
        }),
      ).toBeNull();
    });

    it("holds every terminal and paused state out of the dialable set", () => {
      for (const state of ["SUSPENDED", "DISCARDED", "TORN_DOWN"]) {
        expect(connectionIsDialable(state)).toBe(false);
      }
      for (const state of ["DRAFT", "VERIFIED", "ACTIVE"]) {
        expect(connectionIsDialable(state)).toBe(true);
      }
    });

    it("projects no row when the vault has lost the value", async () => {
      // A credential written under a secret that has since been rotated. The
      // connection stops being dialable, which is true, rather than the fold
      // stopping.
      expect(
        await engineProviderFor({
          connection: connection({
            idpMetadata: {
              issuer: "https://login.acme.okta.com",
              providerId: "okta",
              clientIdRef: "cred_gone",
              secretRef: "cred_also_gone",
              certRefs: [],
            },
          }),
          credentials,
          baseUrl: BASE_URL,
        }),
      ).toBeNull();
    });
  });
});

describe("what LangWatch is, to an identity provider", () => {
  /** @scenario "LangWatch's own details are shown before the identity provider's are asked for" */
  it("answers every address before a connection exists", () => {
    const details = serviceProviderDetailsFor({
      baseUrl: BASE_URL,
      connectionId: null,
    });

    expect(details.redirectUrl).toContain("{connection}");
    expect(details.assertionConsumerServiceUrl).toContain("{connection}");
    expect(details.entityId).toBe(`${BASE_URL}/api/auth/sso/saml2/sp`);
  });

  it("keys the per-connection addresses on the connection once there is one", () => {
    const details = serviceProviderDetailsFor({
      baseUrl: BASE_URL,
      connectionId: CONNECTION,
    });

    expect(details.assertionConsumerServiceUrl).toBe(
      `${BASE_URL}/api/auth/sso/saml2/sp/acs/${CONNECTION}`,
    );
    expect(details.redirectUrl).toBe(
      `${BASE_URL}/api/auth/sso/callback/${CONNECTION}`,
    );
    // One name for the whole deployment: LangWatch is one service provider
    // that talks to many identity providers.
    expect(details.entityId).toBe(`${BASE_URL}/api/auth/sso/saml2/sp`);
  });
});

function catchCode(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}
