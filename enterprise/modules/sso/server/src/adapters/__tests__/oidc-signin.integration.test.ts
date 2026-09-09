// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Starting sign-in against a real OpenID Connect provider. The only stand-in
 * is the identity provider, because the feature IS that endpoints are read out
 * of its discovery document rather than derived from the issuer.
 *
 * Spec: specs/auth/sso-oidc-providers.feature
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGenericOAuthConfigs } from "../better-auth.better-auth.adapter.ts";
import { startFakeOidcProvider, type FakeOidcProvider } from "./support/fake-oidc-provider.ts";

const BASE_URL = "http://localhost:5624";

let idp: FakeOidcProvider;

beforeAll(async () => {
  idp = await startFakeOidcProvider();
});

afterAll(async () => {
  await idp.stop();
});

/** The deployment, as an operator configures it: one provider named, its
 *  credentials set, and every other provider's credentials present but idle. */
function deploymentFederatingTo(provider: string) {
  return betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    plugins: [
      genericOAuth({
        config: buildGenericOAuthConfigs({
          provider,
          baseUrl: BASE_URL,
          cognitoClientId: "cognito-client-id",
          cognitoClientSecret: "cognito-client-secret",
          cognitoIssuer: idp.issuer,
          oneLoginClientId: "onelogin-client-id",
          oneLoginClientSecret: "onelogin-client-secret",
          oneLoginIssuer: idp.issuer,
          oidcClientId: "oidc-client-id",
          oidcClientSecret: "oidc-client-secret",
          oidcIssuer: idp.issuer,
        }),
      }),
    ],
  });
}

/** Starts sign-in the way the sign-in page does, and reports where the
 *  deployment wants to send the browser. */
async function startSignIn(provider: string): Promise<URL> {
  const auth = deploymentFederatingTo(provider);
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ provider, disableRedirect: true }),
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { url?: string };
  expect(body.url).toBeTruthy();
  return new URL(body.url!);
}

describe.each(["cognito", "onelogin", "oidc"])(
  "given a deployment federating to %s",
  (provider) => {
    const clientId = provider === "oidc" ? "oidc-client-id" : `${provider}-client-id`;

    describe("when someone starts sign-in", () => {
      /** @scenario "Starting sign-in sends the browser to the identity provider" */
      it("sends them to the authorization endpoint the issuer published, with the client id, the scopes and the registered redirect URL", async () => {
        const authorize = await startSignIn(provider);

        // The issuer's own path is not the authorization endpoint: the
        // discovery document pointed somewhere else, and following it is the
        // whole feature.
        expect(`${authorize.origin}${authorize.pathname}`).toBe(idp.authorizationEndpoint);
        expect(authorize.searchParams.get("client_id")).toBe(clientId);
        expect((authorize.searchParams.get("scope") ?? "").split(" ")).toEqual(
          expect.arrayContaining(["openid", "email", "profile"]),
        );
        expect(authorize.searchParams.get("redirect_uri")).toBe(
          `${BASE_URL}/api/auth/callback/${provider}`,
        );
        expect(authorize.searchParams.get("response_type")).toBe("code");
      });
    });
  },
);
