/**
 * The engine's provider row, folded from the connection head (D09): what a
 * sign-in can reach, what it cannot, and what the stored document is kept
 * under.
 */
import { sealedProviderConfigCipher, type SsoConnectionState } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import { MemorySsoCredentialRepository } from "../../repositories/memory/memory.sso-credential.repository.ts";
import { MemorySsoEngineProviderRepository } from "../../repositories/memory/memory.sso-engine-provider.repository.ts";
import { SsoEngineProviderService } from "../sso-engine-provider.service.ts";

const BASE_URL = "https://app.langwatch.test";

/** A reversible stand-in for the deployment's cipher. */
const cipher = sealedProviderConfigCipher({
  encrypt: (plaintext) => Buffer.from(plaintext).toString("base64"),
  decrypt: (ciphertext) => Buffer.from(ciphertext, "base64").toString("utf8"),
});

function connectionOf(overrides: Partial<SsoConnectionState> = {}): SsoConnectionState {
  return {
    connectionId: "connection_1",
    organizationId: "org_1",
    type: "oidc",
    state: "ACTIVE",
    claimedDomains: ["acme.test"],
    domainClaims: [],
    approvedDomains: ["acme.test"],
    verifiedDomains: ["acme.test"],
    domainVerifications: [],
    pendingVerification: null,
    idpMetadata: {
      issuer: "https://idp.acme.test",
      providerId: "okta",
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
    arrivalPolicy: "admit",
    arrivalPolicyDecidedAtMs: null,
    source: "self-serve",
    testLoginAccountId: null,
    rejection: null,
    createdBy: "user_1",
    createdAtMs: 0,
    updatedAtMs: 0,
    tearDownAfterMs: null,
    replacesConnectionId: null,
    migrationPhase: null,
    graceStartedAtMs: null,
    routeChangedAtMs: null,
    finalizationRequestedAtMs: null,
    finalizedAtMs: null,
    ...overrides,
  };
}

async function serviceOver(store: MemoryIdentityStore) {
  return SsoEngineProviderService.create({
    credentials: MemorySsoCredentialRepository.create(store),
    rows: MemorySsoEngineProviderRepository.create(store),
    baseUrl: BASE_URL,
    providerConfig: cipher,
  });
}

describe("given an OIDC connection whose credentials the vault holds", () => {
  it("projects a row a sign-in can dial, keyed by the connection", async () => {
    const store = MemoryIdentityStore.create();
    const credentials = MemorySsoCredentialRepository.create(store);
    const clientIdRef = await credentials.put({
      organizationId: "org_1",
      connectionId: "connection_1",
      kind: "oidc-client-id",
      value: "client-1",
    });
    const secretRef = await credentials.put({
      organizationId: "org_1",
      connectionId: "connection_1",
      kind: "oidc-client-secret",
      value: "shhh",
    });
    const service = await serviceOver(store);

    await service.project({
      connection: connectionOf({
        idpMetadata: {
          issuer: "https://idp.acme.test",
          providerId: "okta",
          clientIdRef,
          secretRef,
          certRefs: [],
        },
      }),
    });

    const row = store.ssoEngineProviders.get("connection_1");
    expect(row).toMatchObject({
      id: "connection_1",
      providerId: "connection_1",
      organizationId: "org_1",
      issuer: "https://idp.acme.test",
      domain: "acme.test",
      samlConfig: null,
    });
    expect(JSON.parse(cipher.open(row?.oidcConfig ?? ""))).toEqual({
      clientId: "client-1",
      clientSecret: "shhh",
      discoveryEndpoint: "https://idp.acme.test/.well-known/openid-configuration",
      pkce: true,
      scopes: ["openid", "email", "profile"],
      mapping: { id: "sub", email: "email", emailVerified: "email_verified" },
    });
  });

  /** @scenario "A Microsoft Entra ID connection stored with a trailing slash signs in after the upgrade" */
  it("writes an Entra ID issuer stored with a trailing slash the way its tokens carry it", async () => {
    const entra = "https://login.microsoftonline.com/8f3c2a8e-1b7d-4c0f-9a51-3e6f2d7b9c10/v2.0";
    const store = MemoryIdentityStore.create();
    const credentials = MemorySsoCredentialRepository.create(store);
    const [clientIdRef, secretRef] = await Promise.all([
      credentials.put({
        organizationId: "org_1",
        connectionId: "connection_1",
        kind: "oidc-client-id",
        value: "client-1",
      }),
      credentials.put({
        organizationId: "org_1",
        connectionId: "connection_1",
        kind: "oidc-client-secret",
        value: "shhh",
      }),
    ]);
    const service = await serviceOver(store);

    await service.project({
      connection: connectionOf({
        idpMetadata: {
          issuer: `${entra}/`,
          providerId: "entra",
          clientIdRef,
          secretRef,
          certRefs: [],
        },
      }),
    });

    const row = store.ssoEngineProviders.get("connection_1");
    expect(row?.issuer).toBe(entra);
    expect(JSON.parse(cipher.open(row?.oidcConfig ?? "")).discoveryEndpoint).toBe(
      `${entra}/.well-known/openid-configuration`,
    );
  });

  it("keeps the client secret out of the row it writes", async () => {
    const store = MemoryIdentityStore.create();
    const credentials = MemorySsoCredentialRepository.create(store);
    const clientIdRef = await credentials.put({
      organizationId: "org_1",
      connectionId: "connection_1",
      kind: "oidc-client-id",
      value: "client-1",
    });
    const secretRef = await credentials.put({
      organizationId: "org_1",
      connectionId: "connection_1",
      kind: "oidc-client-secret",
      value: "shhh",
    });
    const service = await serviceOver(store);

    await service.project({
      connection: connectionOf({
        idpMetadata: {
          issuer: "https://idp.acme.test",
          providerId: "okta",
          clientIdRef,
          secretRef,
          certRefs: [],
        },
      }),
    });

    expect(store.ssoEngineProviders.get("connection_1")?.oidcConfig).not.toContain("shhh");
  });

  it("projects nothing while the vault holds no credentials for it", async () => {
    const store = MemoryIdentityStore.create();
    const service = await serviceOver(store);

    await service.project({ connection: connectionOf() });

    expect(store.ssoEngineProviders.size).toBe(0);
  });
});

describe("given a connection nothing may dial", () => {
  it("removes the row a suspension leaves behind", async () => {
    const store = MemoryIdentityStore.create();
    store.ssoEngineProviders.set("connection_1", {
      id: "connection_1",
      providerId: "connection_1",
      organizationId: "org_1",
      issuer: "https://idp.acme.test",
      domain: "acme.test",
      oidcConfig: "{}",
      samlConfig: null,
    });
    const service = await serviceOver(store);

    await service.project({ connection: connectionOf({ state: "SUSPENDED" }) });

    expect(store.ssoEngineProviders.has("connection_1")).toBe(false);
  });
});

describe("given a connection whose claim an operator turned down", () => {
  /** @scenario "A connection whose claim an operator turned down carries nobody" */
  it("projects no row, so the identity provider is never dialled", async () => {
    const store = MemoryIdentityStore.create();
    store.ssoEngineProviders.set("connection_1", {
      id: "connection_1",
      providerId: "connection_1",
      organizationId: "org_1",
      issuer: "https://idp.acme.test",
      domain: "acme.test",
      oidcConfig: "{}",
      samlConfig: null,
    });
    const service = await serviceOver(store);

    await service.project({ connection: connectionOf({ state: "REJECTED" }) });

    expect(store.ssoEngineProviders.has("connection_1")).toBe(false);
  });
});

describe("given a SAML connection whose document the vault holds", () => {
  it("names this deployment as the service provider", async () => {
    const store = MemoryIdentityStore.create();
    const credentials = MemorySsoCredentialRepository.create(store);
    const certRef = await credentials.put({
      organizationId: "org_1",
      connectionId: "connection_1",
      kind: "saml-idp-config",
      value: JSON.stringify({
        entryPoint: "https://idp.acme.test/sso",
        entityId: "https://idp.acme.test/entity",
        metadataXml: null,
        certificate: "CERT",
      }),
    });
    const service = await serviceOver(store);

    await service.project({
      connection: connectionOf({
        type: "saml",
        idpMetadata: {
          issuer: null,
          providerId: "okta",
          clientIdRef: null,
          secretRef: null,
          certRefs: [certRef],
        },
      }),
    });

    const row = store.ssoEngineProviders.get("connection_1");
    expect(row?.issuer).toBe("https://idp.acme.test/entity");
    expect(JSON.parse(cipher.open(row?.samlConfig ?? ""))).toMatchObject({
      entryPoint: "https://idp.acme.test/sso",
      cert: "CERT",
      spMetadata: { entityID: `${BASE_URL}/api/auth/sso/saml2/sp` },
      wantAssertionsSigned: true,
    });
  });
});
