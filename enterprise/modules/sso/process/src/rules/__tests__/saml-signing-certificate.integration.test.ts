// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which assertions a SAML connection's signing certificates authenticate. The
 * engine is the real Better Auth SSO plugin answering at its assertion
 * consumer address, dialled with the same document the identity module
 * stores; the only stand-in is the identity provider, whose certificates are
 * generated when the test runs. The connection's identity policy is the
 * plugin's `resolveUser` hook, which a recorder takes the place of; it lets
 * every arrival continue, as identity does for an admitted one.
 *
 * Spec: specs/identity/sso-idp-termination.feature, specs/auth/phase-1-better-auth-config.feature
 */
import { inflateRawSync } from "node:zlib";

import { sso } from "@better-auth/sso";
import {
  createSigningIdentity,
  idpMetadata,
  signSamlResponse,
  tamperWithAssertion,
  type SigningIdentity,
} from "@langwatch/test-harness/saml-signer";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

const BASE_URL = "http://localhost:5624";
const PROVIDER_ID = "acme-saml";
const IDP_ENTITY_ID = "https://idp.acme.test/entity";
const SP_ENTITY_ID = "https://app.langwatch.test/sso/acme";
const ACS_URL = `${BASE_URL}/api/auth/sso/saml2/sp/acs/${PROVIDER_ID}`;
const EMAIL = "ana@acme.com";

type Dialling = { cert: string } | { metadata: string };

/** The dialling document `samlProviderDocument` stores, in the plugin's shape. */
function samlConnection(dialling: Dialling) {
  return {
    providerId: PROVIDER_ID,
    domain: "acme.com",
    samlConfig: {
      issuer: IDP_ENTITY_ID,
      entryPoint: "https://idp.acme.test/sso",
      callbackUrl: `${BASE_URL}/`,
      ...("cert" in dialling ? { cert: dialling.cert } : {}),
      idpMetadata:
        "metadata" in dialling
          ? { metadata: dialling.metadata, entityID: IDP_ENTITY_ID }
          : { entityID: IDP_ENTITY_ID },
      spMetadata: { entityID: SP_ENTITY_ID },
      wantAssertionsSigned: true,
      mapping: { id: "nameID", email: "email" },
    },
  };
}

/** A deployment whose single connection is dialled as given, and what became of it. */
function deployment(dialling: Dialling) {
  const database = { user: [], session: [], account: [], verification: [] };
  const policyAsked: { providerId: string; email: string }[] = [];
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(database),
    plugins: [
      sso({
        providersLimit: 0,
        defaultSSO: [samlConnection(dialling)],
        saml: { enableInResponseToValidation: true },
        resolveUser: async (input) => {
          policyAsked.push({ providerId: input.providerId, email: input.providerUser.email });
          return { action: "continue" };
        },
      }),
    ],
  });
  return { auth, database, policyAsked };
}

/** Starts sign-in as the page does and reads the request id the engine minted. */
async function startSignIn(auth: ReturnType<typeof deployment>["auth"]) {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ providerId: PROVIDER_ID, callbackURL: "/", requestSignUp: true }),
    }),
  );
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  const redirect = new URL(url);
  const request = inflateRawSync(
    Buffer.from(redirect.searchParams.get("SAMLRequest") ?? "", "base64"),
  ).toString("utf8");
  const requestId = /ID="([^"]+)"/.exec(request)?.[1];
  expect(requestId).toBeTruthy();
  return { requestId: requestId!, relayState: redirect.searchParams.get("RelayState") ?? "" };
}

function claimsFor({ requestId }: { requestId: string }) {
  return {
    issuer: IDP_ENTITY_ID,
    audience: SP_ENTITY_ID,
    recipient: ACS_URL,
    nameId: EMAIL,
    email: EMAIL,
    inResponseTo: requestId,
  };
}

/** The identity provider's browser post to the assertion consumer address. */
async function postAssertion({
  auth,
  samlResponse,
  relayState,
}: {
  auth: ReturnType<typeof deployment>["auth"];
  samlResponse: string;
  relayState: string;
}) {
  return auth.handler(
    new Request(ACS_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE_URL },
      body: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: relayState }),
      redirect: "manual",
    }),
  );
}

async function signInWith({
  dialling,
  sign,
}: {
  dialling: Dialling;
  sign: (input: { requestId: string }) => string;
}) {
  const { auth, database, policyAsked } = deployment(dialling);
  const { requestId, relayState } = await startSignIn(auth);
  const response = await postAssertion({ auth, samlResponse: sign({ requestId }), relayState });
  return { response, database, policyAsked };
}

/** The engine's answer to an assertion it will not believe, by its error code. */
function expectRefusedAsInvalid(response: Response) {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") ?? "", BASE_URL);
  expect(location.searchParams.get("error")).toBe("saml_error");
}

function expectAdmitted(response: Response) {
  expect(response.status).toBe(302);
  expect(
    new URL(response.headers.get("location") ?? "", BASE_URL).searchParams.get("error"),
  ).toBeNull();
}

function nothingWritten(database: ReturnType<typeof deployment>["database"]) {
  expect(database.user).toEqual([]);
  expect(database.account).toEqual([]);
  expect(database.session).toEqual([]);
}

const assertionSignedBy =
  (identity: SigningIdentity) =>
  ({ requestId }: { requestId: string }) =>
    signSamlResponse({ identity, claims: claimsFor({ requestId }) });

describe("given a SAML connection configured with a known signing certificate", () => {
  const known = createSigningIdentity({ commonName: "known.idp.acme.test" });
  const dialling = { cert: known.certificatePem };

  describe("when its identity provider sends an assertion signed by the corresponding key", () => {
    /** @scenario "A signed SAML callback creates the federated identity rows" */
    it("creates one user, one account naming the connection, and one session", async () => {
      const { response, database } = await signInWith({
        dialling,
        sign: assertionSignedBy(known),
      });

      expectAdmitted(response);
      expect(database.user).toHaveLength(1);
      expect(database.account).toHaveLength(1);
      expect(database.session).toHaveLength(1);
      const users: { id: string; email: string }[] = database.user;
      const accounts: { userId: string; providerId: string }[] = database.account;
      const sessions: { userId: string }[] = database.session;
      expect(users[0]?.email).toBe(EMAIL);
      expect(accounts[0]).toMatchObject({ userId: users[0]?.id, providerId: PROVIDER_ID });
      expect(sessions[0]?.userId).toBe(users[0]?.id);
    });

    /** @scenario "A valid signing certificate authenticates an assertion" */
    it("reaches the connection's identity policy", async () => {
      const { response, policyAsked } = await signInWith({
        dialling,
        sign: assertionSignedBy(known),
      });

      expectAdmitted(response);
      expect(policyAsked).toEqual([{ providerId: PROVIDER_ID, email: EMAIL }]);
    });
  });

  describe("when an assertion is signed by an unrelated key or altered after signing", () => {
    /** @scenario "A different or tampered signing certificate authenticates nothing" */
    it("refuses an assertion signed by an unrelated key before identity policy, writing nothing", async () => {
      const stranger = createSigningIdentity({ commonName: "stranger.example.test" });

      const { response, database, policyAsked } = await signInWith({
        dialling,
        sign: assertionSignedBy(stranger),
      });

      expectRefusedAsInvalid(response);
      expect(policyAsked).toEqual([]);
      nothingWritten(database);
    });

    /** @scenario "A different or tampered signing certificate authenticates nothing" */
    it("refuses an assertion altered after it was signed before identity policy, writing nothing", async () => {
      const { response, database, policyAsked } = await signInWith({
        dialling,
        sign: ({ requestId }) =>
          tamperWithAssertion({
            signedResponse: assertionSignedBy(known)({ requestId }),
            replace: `<saml:AttributeValue>${EMAIL}</saml:AttributeValue>`,
            with: "<saml:AttributeValue>root@acme.com</saml:AttributeValue>",
          }),
      });

      expectRefusedAsInvalid(response);
      expect(policyAsked).toEqual([]);
      nothingWritten(database);
    });
  });
});

describe("given a SAML connection whose metadata contains its old and new signing certificates", () => {
  const oldKey = createSigningIdentity({ commonName: "old.idp.acme.test" });
  const newKey = createSigningIdentity({ commonName: "new.idp.acme.test" });
  const dialling = {
    metadata: idpMetadata({
      entityId: IDP_ENTITY_ID,
      singleSignOnUrl: "https://idp.acme.test/sso",
      identities: [oldKey, newKey],
    }),
  };

  describe("when the identity provider sends an assertion signed by either corresponding key", () => {
    /** @scenario "Overlapping signing certificates in metadata both authenticate during rotation" */
    it.each([
      ["old", oldKey],
      ["new", newKey],
    ])(
      "the assertion signed by the %s key reaches the connection's identity policy",
      async (_which, identity) => {
        const { response, policyAsked } = await signInWith({
          dialling,
          sign: assertionSignedBy(identity),
        });

        expectAdmitted(response);
        expect(policyAsked).toEqual([{ providerId: PROVIDER_ID, email: EMAIL }]);
      },
    );
  });
});
