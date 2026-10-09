/**
 * @vitest-environment node
 * @see packages/test-harness/specs/oidc-provider.feature
 */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOidcProvider, type OidcProvider, startOidcProvider } from "../oidc-provider.ts";

const ISSUER = "https://idp.oidc-provider-test.example";
const CLIENT = { clientId: "langwatch-client", clientSecret: "client-secret" };
const REDIRECT_URI = "https://app.langwatch.test/api/auth/sso/callback/acme";
const SUBJECT = { sub: "idp-user-1", email: "ada@acme.example", name: "Ada" };

type TokenResponse = { access_token: string; token_type: string; id_token: string };

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Sends the browser to the authorization endpoint and answers where it is redirected. */
async function authorize({ provider, challenge }: { provider: OidcProvider; challenge: string }) {
  const url = new URL(provider.endpoints.authorization);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT.clientId,
    redirect_uri: REDIRECT_URI,
    scope: "openid email profile",
    state: "state-1",
    nonce: "nonce-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const response = await provider.fetch(url, { redirect: "manual" });
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "");
}

function trade({
  provider,
  code,
  verifier,
  secret = CLIENT.clientSecret,
  redirectUri = REDIRECT_URI,
}: {
  provider: OidcProvider;
  code: string;
  verifier: string;
  secret?: string;
  redirectUri?: string;
}) {
  const basic = Buffer.from(`${CLIENT.clientId}:${secret}`).toString("base64");
  return provider.fetch(provider.endpoints.token, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
}

function decodeVerified({ token, provider }: { token: string; provider: OidcProvider }) {
  const [header = "", payload = "", signature = ""] = token.split(".");
  const key = createPublicKey({ key: provider.publicJwk, format: "jwk" });
  const valid = verify(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    key,
    Buffer.from(signature, "base64url"),
  );
  return { valid, claims: JSON.parse(Buffer.from(payload, "base64url").toString()) as unknown };
}

describe("the OIDC test provider", () => {
  describe("given a provider for a client", () => {
    const provider = createOidcProvider({ issuer: ISSUER, client: CLIENT, subject: SUBJECT });

    /** @scenario "The provider publishes where its endpoints are and which key signs" */
    it("publishes its endpoints and the RS256 key its ID tokens are signed with", async () => {
      const discovery = await (await provider.fetch(provider.endpoints.discovery)).json();
      const keys = await (await provider.fetch(provider.endpoints.jwks)).json();

      expect(discovery).toMatchObject({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        jwks_uri: `${ISSUER}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
      expect(keys).toEqual({ keys: [provider.publicJwk] });
      expect(provider.publicJwk).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
    });
  });

  describe("given a provider signing in a configured subject", () => {
    const provider = createOidcProvider({ issuer: ISSUER, client: CLIENT, subject: SUBJECT });

    describe("when the browser goes through the authorization redirect", () => {
      /** @scenario "A code from the authorization redirect is traded for a signed ID token" */
      it("trades the code for an ID token that verifies, and answers userinfo for the same subject", async () => {
        const { verifier, challenge } = pkce();

        const back = await authorize({ provider, challenge });
        expect(`${back.origin}${back.pathname}`).toBe(REDIRECT_URI);
        expect(back.searchParams.get("state")).toBe("state-1");
        const code = back.searchParams.get("code") ?? "";
        const response = await trade({ provider, code, verifier });
        expect(response.status).toBe(200);
        const tokens = (await response.json()) as TokenResponse;
        expect(tokens.token_type).toBe("Bearer");
        const { valid, claims } = decodeVerified({ token: tokens.id_token, provider });
        const userInfo = await provider.fetch(provider.endpoints.userInfo, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        });

        expect(valid).toBe(true);
        expect(claims).toMatchObject({
          iss: ISSUER,
          aud: CLIENT.clientId,
          nonce: "nonce-1",
          sub: SUBJECT.sub,
          email: SUBJECT.email,
          email_verified: true,
          name: SUBJECT.name,
        });
        await expect(userInfo.json()).resolves.toMatchObject({ sub: SUBJECT.sub });
      });
    });

    describe("when a code is traded wrongly or twice", () => {
      /** @scenario "The token endpoint refuses what a real provider refuses" */
      it("refuses by OAuth error code, and burns a code once traded", async () => {
        const fresh = async () => {
          const { verifier, challenge } = pkce();
          const back = await authorize({ provider, challenge });
          return { code: back.searchParams.get("code") ?? "", verifier };
        };
        const errorOf = async (response: Response) => ({
          status: response.status,
          error: ((await response.json()) as { error: string }).error,
        });

        const wrongSecret = await trade({ provider, ...(await fresh()), secret: "guessed" });
        const wrongVerifier = await trade({ provider, ...(await fresh()), verifier: "guessed" });
        const wrongRedirect = await trade({
          provider,
          ...(await fresh()),
          redirectUri: "https://elsewhere.example/callback",
        });
        const once = await fresh();
        const first = await trade({ provider, ...once });
        const second = await trade({ provider, ...once });

        expect(await errorOf(wrongSecret)).toEqual({ status: 401, error: "invalid_client" });
        expect(await errorOf(wrongVerifier)).toEqual({ status: 400, error: "invalid_grant" });
        expect(await errorOf(wrongRedirect)).toEqual({ status: 400, error: "invalid_grant" });
        expect(first.status).toBe(200);
        expect(await errorOf(second)).toEqual({ status: 400, error: "invalid_grant" });
      });
    });
  });

  describe("given a provider started on a loopback port", () => {
    let served: Awaited<ReturnType<typeof startOidcProvider>>;

    beforeAll(async () => {
      served = await startOidcProvider({ client: CLIENT, subject: SUBJECT });
    });
    afterAll(() => served.stop().catch(() => undefined));

    /** @scenario "The provider is reachable over a loopback port" */
    it("answers its discovery document over the network, then closes the port when stopped", async () => {
      const response = await fetch(served.endpoints.discovery);
      const discovery = (await response.json()) as { issuer: string };

      expect(served.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(discovery.issuer).toBe(served.origin);
      await served.stop();
      await expect(fetch(served.endpoints.discovery)).rejects.toThrow("fetch failed");
    });

    /** @scenario "The provider is reachable over a loopback port" */
    it("keeps signInAs, handle and fetch working on the started provider", async () => {
      const second = await startOidcProvider({ client: CLIENT, subject: SUBJECT });
      try {
        second.signInAs(null);
        const { challenge } = pkce();
        const back = await authorize({ provider: second, challenge });
        expect(back.searchParams.get("error")).toBe("access_denied");
        const viaHandle = await second.handle(new Request(second.endpoints.jwks));
        expect(viaHandle.status).toBe(200);
      } finally {
        await second.stop();
      }
    });
  });
});
