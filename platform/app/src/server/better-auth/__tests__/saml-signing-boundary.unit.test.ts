import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import * as samlify from "samlify";
import { generate } from "selfsigned";
import { beforeAll, describe, expect, it } from "vitest";
import { SsoAssertionService } from "../../app-layer/identity/sso-assertion.service";

type MemoryDB = Record<string, Record<string, unknown>[]>;

const BASE_URL = "http://localhost:3000";
const PROVIDER_ID = "ssoc_acme";
const ACS = `${BASE_URL}/api/auth/sso/saml2/sp/acs/${PROVIDER_ID}`;
const SP_ENTITY_ID = `${BASE_URL}/api/auth/sso/saml2/sp`;
const IDP_ENTITY_ID = "https://idp.acme.test";
const POST_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";

interface SigningIdentity {
  certificate: string;
  idp: ReturnType<typeof samlify.IdentityProvider>;
}

let oldIdentity: SigningIdentity;
let newIdentity: SigningIdentity;
let unrelatedIdentity: SigningIdentity;

async function signingIdentity(commonName: string): Promise<SigningIdentity> {
  const pem = await generate([{ name: "commonName", value: commonName }], {
    notAfterDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    keySize: 2048,
  });
  const idp = samlify.IdentityProvider({
    entityID: IDP_ENTITY_ID,
    privateKey: pem.private,
    signingCert: pem.cert,
    wantAuthnRequestsSigned: false,
    singleSignOnService: [{ Binding: POST_BINDING, Location: `${IDP_ENTITY_ID}/sso` }],
  });
  return { certificate: pem.cert, idp };
}

beforeAll(async () => {
  [oldIdentity, newIdentity, unrelatedIdentity] = await Promise.all([
    signingIdentity("old.acme.test"),
    signingIdentity("new.acme.test"),
    signingIdentity("unrelated.test"),
  ]);
});

function metadataWith(...identities: SigningIdentity[]): string {
  const descriptors = identities.map(({ certificate }) => {
    const body = certificate.replace(/-----[^-]+-----|\s/g, "");
    return `<KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${body}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>`;
  });
  return `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${IDP_ENTITY_ID}"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">${descriptors.join("")}<SingleSignOnService Binding="${POST_BINDING}" Location="${IDP_ENTITY_ID}/sso"/></IDPSSODescriptor></EntityDescriptor>`;
}

async function responseFrom(identity: SigningIdentity, email = "ana@acme.com") {
  const sp = samlify.ServiceProvider({
    entityID: SP_ENTITY_ID,
    wantAssertionsSigned: true,
    assertionConsumerService: [{ Binding: POST_BINDING, Location: ACS }],
  });
  return identity.idp.createLoginResponse(sp, { extract: {} }, "post", { email });
}

function authFor(metadata: string) {
  const db: MemoryDB = {
    user: [],
    account: [],
    session: [],
    verification: [],
    ssoProvider: [
      {
        id: PROVIDER_ID,
        providerId: PROVIDER_ID,
        issuer: IDP_ENTITY_ID,
        organizationId: "org_acme",
        domain: "acme.com",
        domainVerified: true,
        oidcConfig: null,
        samlConfig: JSON.stringify({
          entryPoint: `${IDP_ENTITY_ID}/sso`,
          idpMetadata: { metadata },
          spMetadata: { entityID: SP_ENTITY_ID },
          wantAssertionsSigned: true,
          mapping: { id: "nameID", email: "email" },
        }),
      },
    ],
  };
  const assertion = new SsoAssertionService({
    connections: {
      findConnectionForSignIn: async () => ({
        connectionId: PROVIDER_ID,
        organizationId: "org_acme",
        state: "ACTIVE",
        verifiedDomains: ["acme.com"],
        domainVerifications: [
          {
            domain: "acme.com",
            method: "dns-txt",
            actorId: null,
            verifiedAtMs: Date.now(),
            proofState: "VERIFIED",
            firstAbsentAtMs: null,
            graceEndsAtMs: null,
            tokenHash: "sha256:test-proof",
            evidenceRef: "sha256:test-proof",
            note: null,
            verifier: { type: "system", id: "test-domain-proof" },
          },
        ],
        lapsedDomains: [],
        arrivalPolicy: "admit",
        createdBy: "user_admin",
        source: "self-serve",
        providerId: PROVIDER_ID,
        replacesConnectionId: null,
      }),
    },
    memberships: {
      findRegistrantAtAddress: async () => false,
      findBoundMemberIdentity: async () => false,
    },
  });
  const secondary = new Map<string, string>();
  const auth = betterAuth({
    baseURL: BASE_URL,
    basePath: "/api/auth",
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    verification: { storeInDatabase: true },
    session: { storeSessionInDatabase: true },
    secondaryStorage: {
      get: async (key) => secondary.get(key) ?? null,
      set: async (key, value) => {
        secondary.set(key, value);
      },
      delete: async (key) => {
        secondary.delete(key);
      },
      getAndDelete: async (key) => {
        const value = secondary.get(key) ?? null;
        secondary.delete(key);
        return value;
      },
      increment: async (key) => {
        const next = Number(secondary.get(key) ?? "0") + 1;
        secondary.set(key, String(next));
        return next;
      },
    },
    plugins: [
      sso({
        providersLimit: 0,
        trustEmailVerified: true,
        disableImplicitSignUp: false,
        saml: { allowIdpInitiated: true },
        resolveUser: async (input) =>
          assertion.decide({
            providerId: input.providerId,
            accountId: input.accountKey.accountId,
            email: input.providerUser.email,
          }),
      }),
    ],
  });
  return { auth, db };
}

async function post(auth: ReturnType<typeof authFor>["auth"], samlResponse: string) {
  return auth.handler(
    new Request(ACS, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: samlResponse }),
    }),
  );
}

describe("the mounted SAML signing boundary", () => {
  /** @scenario "A valid signing certificate authenticates an assertion" */
  it("accepts an assertion signed by the configured identity", async () => {
    const { auth, db } = authFor(metadataWith(oldIdentity));
    const signed = await responseFrom(oldIdentity);

    const result = await post(auth, signed.context);

    expect(result.status).toBe(302);
    expect(result.headers.get("location")).not.toContain("error=");
    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(1);
    expect(db.session).toHaveLength(1);
  });

  /** @scenario "A different or tampered signing certificate authenticates nothing" */
  it.each(["unrelated", "tampered"])(
    "rejects an %s assertion without identity writes",
    async (kind) => {
      const { auth, db } = authFor(metadataWith(oldIdentity));
      const signed = await responseFrom(kind === "unrelated" ? unrelatedIdentity : oldIdentity);
      const response =
        kind === "tampered"
          ? Buffer.from(
              Buffer.from(signed.context, "base64")
                .toString()
                .replace("ana@acme.com", "eve@acme.com"),
            ).toString("base64")
          : signed.context;

      const result = await post(auth, response);

      expect(result.status).toBe(302);
      expect(result.headers.get("location")).toContain("error=");
      expect(db.user).toEqual([]);
      expect(db.account).toEqual([]);
      expect(db.session).toEqual([]);
    },
  );

  /** @scenario "Overlapping signing certificates in metadata both authenticate during rotation" */
  it("accepts either certificate in one metadata document", async () => {
    for (const identity of [oldIdentity, newIdentity]) {
      const { auth, db } = authFor(metadataWith(oldIdentity, newIdentity));
      const signed = await responseFrom(identity);

      const result = await post(auth, signed.context);

      expect(result.headers.get("location")).not.toContain("error=");
      expect(db.session).toHaveLength(1);
    }
  });
});
