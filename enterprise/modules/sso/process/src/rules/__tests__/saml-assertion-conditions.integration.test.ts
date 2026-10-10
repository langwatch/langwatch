// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The SAML conditions the real Better Auth SSO plugin enforces, under the default SAML
 * options the deployment passes; only the identity provider is a stand-in.
 * Spec: specs/identity/sso-protocol-conditions.feature
 */
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { sso } from "@better-auth/sso";
import {
  createSigningIdentity,
  signSamlResponse,
  type SamlAssertionClaims,
} from "@langwatch/test-harness/saml-signer";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const BASE_URL = "http://localhost:5624";
const PROVIDER_ID = "acme-saml";
const IDP_ENTITY_ID = "https://idp.acme.test/entity";
const SP_ENTITY_ID = "https://app.langwatch.test/sso/acme";
const ACS_URL = `${BASE_URL}/api/auth/sso/saml2/sp/acs/${PROVIDER_ID}`;
const EMAIL = "ana@acme.com";
const signInResponseSchema = z.object({ url: z.string().url() });
const known = createSigningIdentity({ commonName: "known.idp.acme.test" });

type MemoryEngine = ReturnType<typeof memoryAdapter>;

/** The memory store, refusing a second row under an id it holds, as a primary key does. */
function refusingHeldIds(engine: MemoryEngine): MemoryEngine {
  return (options) => {
    const adapter = engine(options);
    return {
      ...adapter,
      create: async (input) => {
        const id = "id" in input.data ? input.data.id : null;
        const held =
          typeof id === "string" &&
          (await adapter.findOne({ model: input.model, where: [{ field: "id", value: id }] }));
        if (held) throw new Error(`Unique constraint failed on ${input.model}.id`);
        return adapter.create(input);
      },
    };
  };
}

function deployment() {
  const database = { user: [], session: [], account: [], verification: [] };
  const policyAsked: string[] = [];
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: refusingHeldIds(memoryAdapter(database)),
    plugins: [
      sso({
        providersLimit: 0,
        defaultSSO: [
          {
            providerId: PROVIDER_ID,
            domain: "acme.com",
            samlConfig: {
              issuer: IDP_ENTITY_ID,
              entryPoint: "https://idp.acme.test/sso",
              callbackUrl: `${BASE_URL}/`,
              cert: known.certificatePem,
              idpMetadata: { entityID: IDP_ENTITY_ID },
              spMetadata: { entityID: SP_ENTITY_ID },
              wantAssertionsSigned: true,
              mapping: { email: "email" },
            },
          },
        ],
        resolveUser: async (input) => {
          policyAsked.push(input.providerUser.email);
          return { action: "continue" };
        },
      }),
    ],
  });
  return { auth, database, policyAsked };
}

type Deployment = ReturnType<typeof deployment>;

async function startSignIn({ auth }: { auth: Deployment["auth"] }) {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ providerId: PROVIDER_ID, callbackURL: "/", requestSignUp: true }),
    }),
  );
  expect(response.status).toBe(200);
  const redirect = new URL(signInResponseSchema.parse(await response.json()).url);
  const request = inflateRawSync(
    Buffer.from(redirect.searchParams.get("SAMLRequest") ?? "", "base64"),
  ).toString("utf8");
  const requestId = /ID="([^"]+)"/.exec(request)?.[1] ?? "";
  expect(requestId).not.toBe("");
  return { requestId, relayState: redirect.searchParams.get("RelayState") ?? "" };
}

function claimsFor({
  requestId,
  ...overrides
}: { requestId: string } & Partial<SamlAssertionClaims>): SamlAssertionClaims {
  return {
    issuer: IDP_ENTITY_ID,
    audience: SP_ENTITY_ID,
    recipient: ACS_URL,
    nameId: EMAIL,
    email: EMAIL,
    inResponseTo: requestId,
    ...overrides,
  };
}

async function post({
  auth,
  samlResponse,
  relayState,
}: {
  auth: Deployment["auth"];
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

/** One service-provider-initiated sign-in, answered by what `sign` returns. */
async function signInWith({
  sign,
  using = deployment(),
}: {
  sign: (input: { requestId: string }) => string;
  using?: Deployment;
}) {
  const { requestId, relayState } = await startSignIn({ auth: using.auth });
  const samlResponse = sign({ requestId });
  const response = await post({ auth: using.auth, samlResponse, relayState });
  return { ...using, response, samlResponse, relayState };
}

function errorCodeOf(response: Response): string | null {
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "", BASE_URL).searchParams.get("error");
}

function nothingWritten({ database }: { database: Deployment["database"] }) {
  expect(database.user).toEqual([]);
  expect(database.account).toEqual([]);
  expect(database.session).toEqual([]);
}

const signedOnClock =
  ({ skewSeconds }: { skewSeconds: number }) =>
  ({ requestId }: { requestId: string }) =>
    signSamlResponse({
      identity: known,
      claims: claimsFor({ requestId }),
      clockSkewSeconds: skewSeconds,
    });

describe("given a SAML connection that signs with a known key", () => {
  describe("when its identity provider's clock is off by less than the assertion's own window", () => {
    it.each([
      ["30 seconds ahead", 30],
      ["4 minutes behind", -4 * 60],
    ])("admits the assertion from a clock %s", async (_offset, skewSeconds) => {
      const { response, policyAsked, database } = await signInWith({
        sign: signedOnClock({ skewSeconds }),
      });

      expect(errorCodeOf(response)).toBeNull();
      expect(policyAsked).toEqual([EMAIL]);
      expect(database.session).toHaveLength(1);
    });
  });

  describe("when its identity provider's clock is off by more than the assertion's own window", () => {
    /** @scenario "An expired SAML assertion is refused before identity policy" */
    it("refuses the assertion from a clock 10 minutes behind, writing nothing", async () => {
      const { response, policyAsked, database } = await signInWith({
        sign: signedOnClock({ skewSeconds: -10 * 60 }),
      });

      expect(errorCodeOf(response)).toBe("saml_error");
      expect(policyAsked).toEqual([]);
      nothingWritten({ database });
    });

    /** @scenario "A SAML assertion that is not yet valid is refused before identity policy" */
    it("refuses the assertion from a clock 10 minutes ahead, writing nothing", async () => {
      const { response, policyAsked, database } = await signInWith({
        sign: signedOnClock({ skewSeconds: 10 * 60 }),
      });

      expect(errorCodeOf(response)).toBe("saml_error");
      expect(policyAsked).toEqual([]);
      nothingWritten({ database });
    });
  });

  describe("when a signed assertion names another service or address", () => {
    /** @scenario "A SAML assertion for another service provider is refused" */
    it("refuses an assertion whose audience is another service provider", async () => {
      const { response, policyAsked, database } = await signInWith({
        sign: ({ requestId }) =>
          signSamlResponse({
            identity: known,
            claims: claimsFor({ requestId, audience: "https://other.example.test/sp" }),
          }),
      });

      expect(errorCodeOf(response)).toBe("invalid_saml_response");
      expect(policyAsked).toEqual([]);
      nothingWritten({ database });
    });

    /** @scenario "A SAML assertion addressed to another recipient is refused" */
    it("refuses an assertion whose recipient is another assertion consumer address", async () => {
      const { response, policyAsked, database } = await signInWith({
        sign: ({ requestId }) =>
          signSamlResponse({
            identity: known,
            claims: claimsFor({ requestId, recipient: "https://other.example.test/acs" }),
          }),
      });

      expect(errorCodeOf(response)).toBe("invalid_saml_response");
      expect(policyAsked).toEqual([]);
      nothingWritten({ database });
    });
  });

  describe("when the assertion carries no signature", () => {
    /** @scenario "An unsigned SAML assertion is refused" */
    it("refuses it before identity policy, writing nothing", async () => {
      const { response, policyAsked, database } = await signInWith({
        sign: ({ requestId }) =>
          signSamlResponse({ identity: known, claims: claimsFor({ requestId }), unsigned: true }),
      });

      expect(errorCodeOf(response)).toBe("saml_error");
      expect(policyAsked).toEqual([]);
      nothingWritten({ database });
    });
  });

  describe("when an admitted assertion is presented again", () => {
    /** @scenario "Posting an admitted SAML response a second time is refused" */
    it("refuses the same response posted twice, keeping one session", async () => {
      const first = await signInWith({ sign: signedOnClock({ skewSeconds: 0 }) });
      expect(errorCodeOf(first.response)).toBeNull();

      const again = await post({
        auth: first.auth,
        samlResponse: first.samlResponse,
        relayState: first.relayState,
      });

      expect(errorCodeOf(again)).toBe("invalid_saml_response");
      expect(first.database.session).toHaveLength(1);
    });

    /** @scenario "A used SAML assertion id answering a new sign-in is refused as a replay" */
    it("refuses a used assertion id that answers a new sign-in, keeping one session", async () => {
      const assertionId = `_${randomUUID()}`;
      const signWithId = ({ requestId }: { requestId: string }) =>
        signSamlResponse({ identity: known, claims: claimsFor({ requestId, assertionId }) });
      const first = await signInWith({ sign: signWithId });
      expect(errorCodeOf(first.response)).toBeNull();

      const second = await signInWith({ sign: signWithId, using: first });

      expect(errorCodeOf(second.response)).toBe("replay_detected");
      expect(first.database.session).toHaveLength(1);
    });
  });
});
