/**
 * @vitest-environment node
 *
 * A sign-in through a single sign-on connection, end to end (see
 * specs/identity/identity-storage-adapter.feature, "Transactions").
 *
 * This is the regression the transaction work exists for. `resolveUser` is
 * configured — it is what checks the connection's proved domains before
 * better-auth links an asserted address onto an existing account, and what
 * makes `trustEmailVerified` defensible — and `@better-auth/sso` refuses to
 * run it at all unless the adapter declares a native transaction. The adapter
 * declared none, so every sign-in through a connection was answered with
 * `SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS` before it reached the
 * identity provider. It had never once succeeded.
 *
 * What is real here: the composed identity storage adapter, Postgres, the
 * app's own plugin list (so the `sso()` options and the `resolveUser`
 * wrapper are production's, not a second set written for the test), and the
 * plugin's whole OIDC callback including the transaction, the provider-row
 * lock and the boundary check.
 *
 * What stands in: the identity provider, as a stubbed `fetch` answering the
 * discovery, token and JWKS endpoints with a signed id token; and the
 * assertion decision, which is the seam "a VERIFIED connection" means at this
 * level — whether a connection's proved domains admit this address is
 * `SsoAssertionService`'s own suite's subject, not this one's.
 */

import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { models } from "~/server/better-auth/config/models";
import { plugins } from "~/server/better-auth/config/plugins";
import type { PasskeySignUpRegistration } from "~/server/better-auth/passkey-signup";
import { prisma } from "~/server/db";
import { identityStorageAdapter } from "../runtime";

const BASE_URL = "http://localhost:3000";
const SUITE = nanoid(8).toLowerCase();
const PROVIDER_ID = `sso-signin-test-${SUITE}`;
const IDP = `https://idp-${SUITE}.sso-signin-test.example`;
const CLIENT_ID = "langwatch-test-client";
const SUBJECT = `idp-subject-${SUITE}`;
const EMAIL = `member-${SUITE}@${SUITE}.sso-signin-test.example`;

/** Every decision the app's `resolveUser` asked for, so the test can say the
 *  production wrapper really ran rather than assuming it. */
const decisionsAsked: Array<{ providerId: string; email?: string | null }> = [];

let auth: ReturnType<typeof buildAuth>;
let idToken: string;
let jwks: { keys: unknown[] };
let realFetch: typeof globalThis.fetch;

const base64url = (input: string | Uint8Array): string =>
  Buffer.from(input as Uint8Array).toString("base64url");

/**
 * One signed id token and the public half to verify it with, minted through
 * WebCrypto rather than a library: the token is the identity provider's whole
 * contribution to this flow, and the plugin verifies it against the JWKS the
 * stub serves, so nothing here is trusted on our say-so.
 */
async function mintIdToken(claims: Record<string, unknown>): Promise<{
  token: string;
  jwk: Record<string, unknown>;
}> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", publicKey);
  const header = base64url(
    JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" }),
  );
  const payload = base64url(JSON.stringify(claims));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  );
  return {
    token: `${header}.${payload}.${base64url(signature)}`,
    jwk: {
      kty: exported.kty,
      n: exported.n,
      e: exported.e,
      alg: "RS256",
      kid: "test",
      use: "sig",
    },
  };
}

/**
 * The application's own better-auth, with its real plugin list: the `sso()`
 * options and the `resolveUser` wrapper under test are production's, and only
 * the decision that wrapper asks for is the suite's.
 */
const buildAuth = () =>
  betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: identityStorageAdapter(),
    trustedOrigins: [IDP, BASE_URL],
    plugins: plugins({
      backupCodeCount: 10,
      // Never reached: nothing here registers a passkey.
      passkeySignUp: () => ({}) as PasskeySignUpRegistration,
      confirmSignUpAddress: async () => undefined,
      ssoAssertion: () => ({
        decide: async ({ providerId, email }) => {
          decisionsAsked.push({ providerId, email });
          return { action: "continue" };
        },
      }),
      ssoCallbackEvidence: () => ({ recordAuthenticatedSsoAccount: () => {} }),
    }),
    ...models(),
  });

const respond = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeAll(async () => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const minted = await mintIdToken({
    iss: IDP,
    aud: CLIENT_ID,
    sub: SUBJECT,
    email: EMAIL,
    email_verified: true,
    name: "Sam Sso",
    iat: issuedAt,
    exp: issuedAt + 300,
  });
  idToken = minted.token;
  jwks = { keys: [minted.jwk] };

  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.startsWith(`${IDP}/.well-known/openid-configuration`)) {
      return respond({
        issuer: IDP,
        authorization_endpoint: `${IDP}/authorize`,
        token_endpoint: `${IDP}/token`,
        jwks_uri: `${IDP}/jwks`,
      });
    }
    if (url.startsWith(`${IDP}/token`)) {
      return respond({
        access_token: `access-${SUITE}`,
        id_token: idToken,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url.startsWith(`${IDP}/jwks`)) {
      return respond(jwks);
    }
    return realFetch(input, init);
  }) as typeof globalThis.fetch;

  await prisma.ssoProvider.create({
    data: {
      id: `ssoprov_${nanoid(12)}`,
      providerId: PROVIDER_ID,
      issuer: IDP,
      domain: `${SUITE}.sso-signin-test.example`,
      // Written in the plaintext form the cipher still reads, so this row is
      // the derivation's shape without the deployment's secret in it.
      oidcConfig: JSON.stringify({
        clientId: CLIENT_ID,
        clientSecret: "langwatch-test-secret",
        discoveryEndpoint: `${IDP}/.well-known/openid-configuration`,
        authorizationEndpoint: `${IDP}/authorize`,
        tokenEndpoint: `${IDP}/token`,
        jwksEndpoint: `${IDP}/jwks`,
        pkce: true,
        scopes: ["openid", "email", "profile"],
        mapping: { id: "sub", email: "email", emailVerified: "email_verified" },
      }),
    },
  });

  auth = buildAuth();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await prisma.ssoProvider.deleteMany({ where: { providerId: PROVIDER_ID } });
  const user = await prisma.user.findFirst({
    where: { email: EMAIL },
    select: { id: true },
  });
  if (user) {
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.account.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.verificationToken.deleteMany({
    where: { identifier: { contains: PROVIDER_ID } },
  });
});

describe("given a verified single sign-on connection", () => {
  describe("when somebody signs in through it", () => {
    /** @scenario "A sign-in through a connection completes" */
    it("signs them in, and does not refuse the adapter its transactions", async () => {
      const started = await auth.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerId: PROVIDER_ID,
            callbackURL: `${BASE_URL}/dashboard`,
          }),
        }),
      );
      expect(started.status).toBe(200);
      const authorize = new URL(
        ((await started.json()) as { url: string }).url,
      );
      const state = authorize.searchParams.get("state");
      expect(state).not.toBeNull();

      // The browser carries the signed state cookie back from the redirect,
      // and the plugin checks it against the state it stored. A callback
      // without it is refused before any of this file's subject runs.
      const stateCookie = started.headers.get("set-cookie") ?? "";

      const callback = await auth.handler(
        new Request(
          `${BASE_URL}/api/auth/sso/callback/${PROVIDER_ID}?code=test-code&state=${state}`,
          {
            method: "GET",
            redirect: "manual",
            headers: { cookie: stateCookie },
          },
        ),
      );

      const location = callback.headers.get("location") ?? "";
      // The refusal this whole change is about, named rather than implied: it
      // arrived as a redirect carrying the code and nothing else, which is
      // what made it so hard to see.
      expect(location).not.toContain(
        "SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS",
      );
      expect(location).not.toContain("error");
      expect(location).toBe(`${BASE_URL}/dashboard`);

      // Production's own `resolveUser` ran — the sign-in went through the
      // pre-link check rather than around it.
      expect(decisionsAsked).toEqual([
        { providerId: PROVIDER_ID, email: EMAIL },
      ]);

      const cookie = callback.headers
        .getSetCookie()
        .map((set) => set.split(";")[0])
        .join("; ");
      expect(cookie).not.toBe("");
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      expect(session?.user.email).toBe(EMAIL);

      expect(
        await prisma.account.findFirst({
          where: { provider: PROVIDER_ID, providerAccountId: SUBJECT },
          select: { providerAccountId: true },
        }),
      ).not.toBeNull();
    });
  });
});
