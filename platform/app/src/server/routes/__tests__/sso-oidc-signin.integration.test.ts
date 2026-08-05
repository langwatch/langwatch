/**
 * @vitest-environment node
 *
 * Proves the Cognito and OneLogin wiring end to end at the HTTP layer
 * (specs/auth/sso-oidc-providers.feature).
 *
 * Nothing on the path under test is stubbed: this boots the real app auth
 * route, which builds a real BetterAuth instance from our real provider
 * builders, and fires a real sign-in request at it. The only stand-in is the
 * identity provider itself, a local HTTP server publishing a genuine OIDC
 * discovery document, because the point of the feature is that we read the
 * endpoints out of that document rather than hard-coding them. The assertions
 * are on the authorization URL the app actually sends the browser to.
 */
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const APP_URL = "http://localhost:5624";

/**
 * A stand-in identity provider. Publishes the same discovery document shape a
 * real one does, with authorize/token/userinfo on a different host from the
 * issuer, which is exactly the Cognito arrangement (the issuer lives on
 * `cognito-idp.<region>.amazonaws.com`, the endpoints on the hosted-UI domain)
 * and the reason discovery is what we read instead of deriving URLs ourselves.
 */
const startIdp = async (): Promise<{ server: Server; issuer: string }> => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      const issuer = `http://${req.headers.host}${url.pathname.replace(
        "/.well-known/openid-configuration",
        "",
      )}`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/hosted-ui/oauth2/authorize`,
          token_endpoint: `${issuer}/hosted-ui/oauth2/token`,
          userinfo_endpoint: `${issuer}/hosted-ui/oauth2/userInfo`,
          jwks_uri: `${issuer}/.well-known/jwks.json`,
          response_types_supported: ["code"],
          scopes_supported: ["openid", "email", "profile"],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, issuer: `http://127.0.0.1:${port}/oidc/2` };
};

type HonoTestApp = {
  request: (path: string, init: RequestInit) => Promise<Response> | Response;
};

const envBackup: Record<string, string | undefined> = {};
const TOUCHED = [
  "NODE_ENV",
  "NEXTAUTH_URL",
  "BASE_HOST",
  "NEXTAUTH_PROVIDER",
  "LANGWATCH_LICENSE_KEY",
  "LANGWATCH_LICENSE_PUBLIC_KEY",
  "COGNITO_CLIENT_ID",
  "COGNITO_CLIENT_SECRET",
  "COGNITO_ISSUER",
  "ONELOGIN_CLIENT_ID",
  "ONELOGIN_CLIENT_SECRET",
  "ONELOGIN_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_ISSUER",
];

/**
 * SSO rides the platform license gate (ADR-027), so an unlicensed deployment
 * would refuse sign-in before any of this is reached. Mint a real Enterprise
 * license against a throwaway keypair, which is the same thing a licensed
 * customer has and keeps the gate itself unmocked.
 */
const licenseThisDeployment = async (): Promise<void> => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  // Set before the app graph evaluates: the verifying key is read at import.
  process.env.LANGWATCH_LICENSE_PUBLIC_KEY = publicKey;

  const { signLicense, encodeLicenseKey } = await import(
    "@ee/licensing/signing"
  );
  process.env.LANGWATCH_LICENSE_KEY = encodeLicenseKey(
    signLicense(
      {
        licenseId: "lic_sso_oidc_integration",
        version: 1,
        organizationName: "OIDC Integration Test",
        email: "integration@example.com",
        issuedAt: new Date().toISOString(),
        expiresAt: "2099-01-01T00:00:00Z",
        plan: {
          type: "ENTERPRISE",
          name: "Enterprise",
          maxMembers: 100,
          maxMessagesPerMonth: 1_000_000,
          canPublish: true,
        },
      },
      privateKey,
    ),
  );
};

/**
 * Starts sign-in the way the sign-in page does and reports what came back:
 * the status, and the URL the app wants to send the browser to.
 */
const startSignIn = async (
  app: HonoTestApp,
  provider: string,
): Promise<{ status: number; url: string | undefined }> => {
  const response = await app.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP_URL },
    body: JSON.stringify({ provider, disableRedirect: true }),
  });

  const body =
    response.status === 200
      ? ((await response.json()) as { url?: string })
      : { url: undefined };
  return { status: response.status, url: body.url };
};

describe("given a self-hosted deployment federating to an OIDC identity provider", () => {
  let idp: { server: Server; issuer: string };
  let app: HonoTestApp;

  beforeAll(async () => {
    idp = await startIdp();

    for (const name of TOUCHED) envBackup[name] = process.env[name];

    process.env.NODE_ENV = "development";
    await licenseThisDeployment();
    process.env.NEXTAUTH_URL = APP_URL;
    process.env.BASE_HOST = APP_URL;
    process.env.COGNITO_CLIENT_ID = "cognito-client-id";
    process.env.COGNITO_CLIENT_SECRET = "cognito-client-secret";
    process.env.COGNITO_ISSUER = idp.issuer;
    process.env.ONELOGIN_CLIENT_ID = "onelogin-client-id";
    process.env.ONELOGIN_CLIENT_SECRET = "onelogin-client-secret";
    process.env.ONELOGIN_ISSUER = idp.issuer;
    process.env.OIDC_CLIENT_ID = "oidc-client-id";
    process.env.OIDC_CLIENT_SECRET = "oidc-client-secret";
    process.env.OIDC_ISSUER = idp.issuer;
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(envBackup)) {
      if (value === void 0) delete process.env[name];
      else process.env[name] = value;
    }
    vi.resetModules();
    await new Promise<void>((resolve) => idp.server.close(() => resolve()));
  });

  describe.each([
    { provider: "cognito", clientId: "cognito-client-id" },
    { provider: "onelogin", clientId: "onelogin-client-id" },
    { provider: "oidc", clientId: "oidc-client-id" },
  ])("when NEXTAUTH_PROVIDER is $provider", ({ provider, clientId }) => {
    let started: { status: number; url: string | undefined };
    let authorizeUrl: URL;

    beforeAll(async () => {
      process.env.NEXTAUTH_PROVIDER = provider;
      vi.resetModules();
      ({ app } = await import("~/server/routes/auth"));
      started = await startSignIn(app, provider);
      if (started.url) authorizeUrl = new URL(started.url);
    });

    /** @scenario Starting sign-in sends the browser to the identity provider */
    it("accepts the sign-in request and answers with somewhere to go", () => {
      expect(started.status).toBe(200);
      expect(started.url).toBeTruthy();
    });

    /** @scenario Starting sign-in sends the browser to the identity provider */
    it("sends the browser to the authorization endpoint the issuer published", () => {
      // Not the issuer host: the discovery document pointed somewhere else,
      // and following it is the whole feature.
      expect(`${authorizeUrl.origin}${authorizeUrl.pathname}`).toBe(
        `${idp.issuer}/hosted-ui/oauth2/authorize`,
      );
    });

    /** @scenario Starting sign-in sends the browser to the identity provider */
    it("carries the configured client id", () => {
      expect(authorizeUrl.searchParams.get("client_id")).toBe(clientId);
    });

    /** @scenario Starting sign-in sends the browser to the identity provider */
    it("asks for the openid, email and profile scopes", () => {
      const scopes = (authorizeUrl.searchParams.get("scope") ?? "").split(" ");
      expect(scopes).toEqual(
        expect.arrayContaining(["openid", "email", "profile"]),
      );
    });

    /** @scenario Starting sign-in sends the browser to the identity provider */
    it("carries the redirect URL an operator registers with the identity provider", () => {
      expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
        `${APP_URL}/api/auth/callback/${provider}`,
      );
    });

    it("asks for an authorization code", () => {
      expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
    });

    /**
     * The config carries `pkce: true`, but only the emitted URL shows whether
     * that reached the identity provider, and this is the only suite that
     * looks at the URL.
     */
    it("carries a PKCE challenge", () => {
      expect(authorizeUrl.searchParams.get("code_challenge")).toBeTruthy();
      expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe(
        "S256",
      );
    });
  });
});
