// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  CONNECTION_IDP_UPDATED_EVENT_TYPE,
  emptySsoConnection,
  type SsoConnectionState,
} from "@langwatch/identity";
import { describe, expect, it, vi } from "vitest";
import { ssoConnectionHistoryCopy } from "../sso-connection-history-copy";
import {
  engineProviderFor,
  serviceProviderDetailsFor,
} from "../sso-engine-provider";
import type { SsoIssuerDiscoveryPort } from "../sso-idp-registration";
import { plaintextProviderConfigCipher } from "../sso-provider-config";
import { createSsoSelfServeFixture } from "./support/sso-self-serve.fixture";

/**
 * Editing an existing connection's identity provider settings
 * (specs/identity/sso-connection-edit-identity-provider.feature).
 *
 * A customer report: an Entra ID connection registered with a wrong issuer
 * could only be fixed by deleting it, which gave the new connection a new id
 * and so a new redirect address. These tests pin that the edit keeps the id,
 * re-runs the registration's checks, and dials the new settings.
 */

const ORG = "org_acme";
const CONNECTION = "ssoconn_acme";
const BASE_URL = "https://app.langwatch.test";
const WRONG = "https://login.microsoftonline.com/wrong-tenant/v2.0";
const RIGHT = "https://login.microsoftonline.com/right-tenant/v2.0";
const ANA = { userId: "usr_ana" };

const discoveryNaming = (issuer?: string): SsoIssuerDiscoveryPort => ({
  async discover() {
    return issuer === undefined
      ? { reachable: true }
      : { reachable: true, issuer };
  },
});

async function fixtureWith({
  state = "ACTIVE",
  source = "self-serve",
  discovery,
}: {
  state?: SsoConnectionState["state"];
  source?: SsoConnectionState["source"];
  discovery?: SsoIssuerDiscoveryPort;
} = {}) {
  const fixture = createSsoSelfServeFixture({
    context: {
      deployment: "hosted",
      licensed: true,
      licenseActivationPending: false,
      optedIn: true,
      singleOrganization: false,
      actorIsPlatformOperator: false,
    },
    now: () => 1_756_000_000_000,
    discovery,
  });
  const put = (kind: "oidc-client-id" | "oidc-client-secret", value: string) =>
    fixture.credentials.put({
      organizationId: ORG,
      connectionId: CONNECTION,
      kind,
      value,
    });
  const clientIdRef = await put("oidc-client-id", "client_old");
  const secretRef = await put("oidc-client-secret", "secret_old");
  fixture.connections.seed({
    ...emptySsoConnection({ connectionId: CONNECTION }),
    organizationId: ORG,
    type: "oidc",
    state,
    source,
    verifiedDomains: ["acme.com"],
    arrivalPolicy: "admit",
    arrivalPolicyDecidedAtMs: 1_755_000_000_000,
    idpMetadata: {
      issuer: WRONG,
      providerId: "Acme Entra",
      clientIdRef,
      secretRef,
      certRefs: [],
    },
  });
  const current = async () => {
    const found = await fixture.connections.findConnection({
      connectionId: CONNECTION,
    });
    if (!found) throw new Error("the seeded connection is gone");
    return found;
  };
  const dialed = async () => {
    const row = await engineProviderFor({
      connection: await current(),
      credentials: fixture.credentials,
      baseUrl: BASE_URL,
      providerConfig: plaintextProviderConfigCipher,
    });
    return {
      issuer: row?.issuer,
      config: JSON.parse(row?.oidcConfig ?? "{}") as {
        clientId?: string;
        clientSecret?: string;
        discoveryEndpoint?: string;
      },
    };
  };
  return { fixture, current, dialed, clientIdRef, secretRef };
}

const oidc = (
  overrides: Partial<{
    issuer: string;
    clientId: string;
    clientSecret: string | null;
  }> = {},
) => ({
  protocol: "oidc" as const,
  issuer: RIGHT,
  clientId: "client_new",
  clientSecret: "secret_new" as string | null,
  ...overrides,
});

const refusalOf = (promise: Promise<unknown>) =>
  promise
    .then(() => ({ code: "no refusal" }))
    .catch((error: unknown) => error as { code: string });

describe("editing a connection's identity provider settings", () => {
  describe("given a connection still being set up", () => {
    describe("when the administrator changes the issuer, client id and secret", () => {
      /** @scenario "Editing the identity provider keeps the connection id and redirect address" */
      it("dials the new settings on the same connection id and redirect address", async () => {
        const { fixture, current, dialed } = await fixtureWith({
          state: "VERIFIED",
        });
        const before = await current();
        const redirectBefore = serviceProviderDetailsFor({
          baseUrl: BASE_URL,
          connectionId: before.connectionId,
        }).redirectUrl;

        await fixture.selfServe.updateIdentityProvider({
          organizationId: ORG,
          connectionId: CONNECTION,
          idp: oidc(),
          actor: ANA,
        });

        const after = await current();
        expect(after.connectionId).toBe(CONNECTION);
        expect(
          serviceProviderDetailsFor({
            baseUrl: BASE_URL,
            connectionId: after.connectionId,
          }).redirectUrl,
        ).toBe(redirectBefore);
        expect(after.idpMetadata.issuer).toBe(RIGHT);
        expect(after.idpMetadata.providerId).toBe("Acme Entra");
        expect(after.verifiedDomains).toEqual(["acme.com"]);
        expect(after.arrivalPolicy).toBe("admit");
        expect(after.state).toBe("VERIFIED");

        const engine = await dialed();
        expect(engine.issuer).toBe(RIGHT);
        expect(engine.config).toMatchObject({
          clientId: "client_new",
          clientSecret: "secret_new",
          discoveryEndpoint: `${RIGHT}/.well-known/openid-configuration`,
        });
      });
    });
  });

  describe("given a live connection", () => {
    describe("when the administrator fixes the issuer", () => {
      /** @scenario "A live connection can be edited" */
      it("dials the new issuer and stays live", async () => {
        const { fixture, current, dialed } = await fixtureWith({
          state: "ACTIVE",
        });

        await fixture.selfServe.updateIdentityProvider({
          organizationId: ORG,
          connectionId: CONNECTION,
          idp: oidc(),
          actor: ANA,
        });

        expect((await current()).state).toBe("ACTIVE");
        expect((await dialed()).issuer).toBe(RIGHT);
      });
    });

    describe("when the client secret is left blank", () => {
      /** @scenario "A blank client secret keeps the stored secret" */
      it("keeps the stored secret", async () => {
        const { fixture, current, dialed, secretRef } = await fixtureWith();

        await fixture.selfServe.updateIdentityProvider({
          organizationId: ORG,
          connectionId: CONNECTION,
          idp: oidc({ clientSecret: "" }),
          actor: ANA,
        });

        expect((await current()).idpMetadata.secretRef).toBe(secretRef);
        expect((await dialed()).config.clientSecret).toBe("secret_old");
      });
    });

    describe("when the settings it already has are saved", () => {
      /** @scenario "Saving unchanged settings records nothing" */
      it("records nothing and stores no credential", async () => {
        const { fixture } = await fixtureWith({
          discovery: discoveryNaming(WRONG),
        });
        const put = vi.spyOn(fixture.credentials, "put");
        const committedBefore = fixture.committed.flatMap((c) => c.facts);

        await fixture.selfServe.updateIdentityProvider({
          organizationId: ORG,
          connectionId: CONNECTION,
          idp: oidc({
            issuer: WRONG,
            clientId: "client_old",
            clientSecret: null,
          }),
          actor: ANA,
        });

        expect(put).not.toHaveBeenCalled();
        expect(fixture.committed.flatMap((c) => c.facts)).toEqual(
          committedBefore,
        );
      });
    });

    describe("when the discovery document names another issuer", () => {
      /** @scenario "An issuer that fails discovery is refused and nothing changes" */
      it("refuses with the issuer mismatch error and changes nothing", async () => {
        const { fixture, current } = await fixtureWith({
          discovery: discoveryNaming("https://login.example.com/other"),
        });
        const before = await current();
        const put = vi.spyOn(fixture.credentials, "put");

        const refusal = await refusalOf(
          fixture.selfServe.updateIdentityProvider({
            organizationId: ORG,
            connectionId: CONNECTION,
            idp: oidc(),
            actor: ANA,
          }),
        );

        expect(refusal.code).toBe("sso_issuer_mismatch");
        expect(put).not.toHaveBeenCalled();
        expect(await current()).toEqual(before);
      });

      it("refuses an Entra ID multi-tenant issuer the same way registration does", async () => {
        const { fixture, current } = await fixtureWith();
        const before = await current();

        const refusal = await refusalOf(
          fixture.selfServe.updateIdentityProvider({
            organizationId: ORG,
            connectionId: CONNECTION,
            idp: oidc({
              issuer: "https://login.microsoftonline.com/common/v2.0",
            }),
            actor: ANA,
          }),
        );

        expect(refusal.code).toBe("sso_issuer_multi_tenant");
        expect(await current()).toEqual(before);
      });
    });

    describe("when SAML settings are sent for an OpenID Connect connection", () => {
      /** @scenario "The protocol cannot change on an existing connection" */
      it("refuses and changes nothing", async () => {
        const { fixture, current } = await fixtureWith();
        const before = await current();

        const refusal = await refusalOf(
          fixture.selfServe.updateIdentityProvider({
            organizationId: ORG,
            connectionId: CONNECTION,
            idp: {
              protocol: "saml",
              entryPoint: "https://login.acme.example/sso",
              entityId: "https://login.acme.example",
              metadataXml: null,
              certificate: null,
            },
            actor: ANA,
          }),
        );

        expect(refusal.code).toBe("sso_connection_invalid_transition");
        expect(await current()).toEqual(before);
      });
    });
  });

  describe("given a connection whose removal was requested", () => {
    describe("when the administrator changes the issuer", () => {
      /** @scenario "A connection being removed cannot be edited" */
      it("refuses", async () => {
        const { fixture, current } = await fixtureWith({
          state: "TEARDOWN_PENDING",
        });

        const refusal = await refusalOf(
          fixture.selfServe.updateIdentityProvider({
            organizationId: ORG,
            connectionId: CONNECTION,
            idp: oidc(),
            actor: ANA,
          }),
        );

        expect(refusal.code).toBe("sso_connection_invalid_transition");
        expect((await current()).idpMetadata.issuer).toBe(WRONG);
      });
    });
  });

  describe("given a grandfathered connection", () => {
    it("refuses, because it has no settings of its own", async () => {
      const { fixture } = await fixtureWith({
        source: "legacy-grandfathered",
      });

      const refusal = await refusalOf(
        fixture.selfServe.updateIdentityProvider({
          organizationId: ORG,
          connectionId: CONNECTION,
          idp: oidc(),
          actor: ANA,
        }),
      );

      expect(refusal.code).toBe("sso_connection_invalid_transition");
    });
  });

  describe("given another organization's connection", () => {
    it("answers that it does not exist", async () => {
      const { fixture } = await fixtureWith();

      const refusal = await refusalOf(
        fixture.selfServe.updateIdentityProvider({
          organizationId: "org_other",
          connectionId: CONNECTION,
          idp: oidc(),
          actor: ANA,
        }),
      );

      expect(refusal.code).toBe("sso_connection_not_found");
    });
  });
});

describe("prefilling the edit form", () => {
  describe("given an OpenID Connect connection", () => {
    it("answers the issuer and client id, and only whether a secret is stored", async () => {
      const { fixture } = await fixtureWith();

      const view = await fixture.selfServe.getIdentityProvider({
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      expect(view).toEqual({
        protocol: "oidc",
        issuer: WRONG,
        clientId: "client_old",
        hasClientSecret: true,
      });
      expect(JSON.stringify(view)).not.toContain("secret_old");
    });
  });
});

describe("the history line for an identity provider change", () => {
  describe("given a connection whose settings were changed", () => {
    /** @scenario "The change is on the connection's history" */
    it("says the settings changed and names the new issuer", () => {
      const summary = ssoConnectionHistoryCopy({
        type: CONNECTION_IDP_UPDATED_EVENT_TYPE,
        domain: null,
        method: null,
        route: null,
        policy: null,
        note: null,
        name: null,
        issuer: RIGHT,
      });

      expect(summary).toContain("identity provider settings were changed");
      expect(summary).toContain(RIGHT);
    });
  });
});
