/**
 * @vitest-environment node
 * @see specs/identity/mfa-and-session-shape.feature
 * An identity provider unreachable at startup: the real better-auth context build, Okta requiring
 * verified ID tokens, against a port nothing listens on, then a provider brought up there.
 */

import { createSign, generateKeyPairSync, type KeyObject, randomUUID } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { okta } from "better-auth/plugins/generic-oauth";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { resilientGenericOAuth } from "../http.resilient-generic-oauth.channel.ts";

type MemoryDb = Record<string, Record<string, unknown>[]>;

const BASE_URL = "http://localhost:3000";
const CLIENT_ID = "okta-client";
const authorizationResponseSchema = z.object({ url: z.string().url() });

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/** A port that was free a moment ago and has nothing listening on it. */
const closedPort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (address === null || typeof address === "string") throw new Error("the probe has no port");
  const { port } = address;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
};

const json = (response: ServerResponse, value: unknown) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

/**
 * An Okta-shaped identity provider on `port`. Its token endpoint signs ID
 * tokens with a key the JWKS does not publish, so a callback succeeds only if
 * the token is accepted without verification.
 */
const startIdentityProvider = async ({
  port,
  publishJwks,
}: {
  port: number;
  publishJwks: boolean;
}) => {
  const published = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const unpublished: KeyObject = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey;
  const issuer = `http://127.0.0.1:${port}`;
  const nonces = new Map<string, string>();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      json(response, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        ...(publishJwks ? { jwks_uri: `${issuer}/jwks` } : {}),
        id_token_signing_alg_values_supported: ["RS256"],
      });
      return;
    }
    if (url.pathname === "/jwks") {
      json(response, {
        keys: [
          {
            ...published.publicKey.export({ format: "jwk" }),
            alg: "RS256",
            kid: "k1",
            use: "sig",
          },
        ],
      });
      return;
    }
    if (url.pathname === "/token") {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const code = new URLSearchParams(body).get("code") ?? "";
      const now = Math.floor(Date.now() / 1_000);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const input = `${encode({ alg: "RS256", kid: "k1", typ: "JWT" })}.${encode({
        iss: issuer,
        aud: CLIENT_ID,
        sub: "okta-user-sam",
        email: "sam@acme.test",
        email_verified: true,
        nonce: nonces.get(code) ?? "",
        iat: now,
        exp: now + 300,
      })}`;
      const signer = createSign("RSA-SHA256");
      signer.update(input);
      json(response, {
        access_token: `access-${code}`,
        token_type: "Bearer",
        expires_in: 300,
        id_token: `${input}.${signer.sign(unpublished).toString("base64url")}`,
      });
      return;
    }
    if (url.pathname === "/userinfo") {
      json(response, { sub: "okta-user-sam", email: "sam@acme.test" });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  servers.push(server);
  return { nonces };
};

const buildAuth = ({
  issuerPort,
  retryDelaysMs = [],
}: {
  issuerPort: number;
  retryDelaysMs?: number[];
}) => {
  const db: MemoryDb = { user: [], session: [], account: [], verification: [] };
  const config = [
    {
      ...okta({
        clientId: CLIENT_ID,
        clientSecret: "okta-secret",
        issuer: `http://127.0.0.1:${issuerPort}`,
      }),
      requireIdTokenVerification: true,
    },
  ];
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    account: { accountLinking: { enabled: true } },
    plugins: [resilientGenericOAuth({ config, retryDelaysMs })],
  });
  return { auth, db, config };
};

const startOktaSignIn = (auth: ReturnType<typeof buildAuth>["auth"]) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "okta", disableRedirect: true }),
    }),
  );

const signUpWithPassword = (auth: ReturnType<typeof buildAuth>["auth"]) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `pat-${randomUUID()}@acme.test`,
        password: "a-long-enough-password",
        name: "Pat",
      }),
    }),
  );

const waitForOktaSignIn = async (auth: ReturnType<typeof buildAuth>["auth"]): Promise<Response> => {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const response = await startOktaSignIn(auth);
    if (response.status === 200 || Date.now() > deadline) return response;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

describe("given Okta requires verified ID tokens", () => {
  describe("when its identity provider refuses connections at startup", () => {
    /** @scenario "An unreachable identity provider at startup does not take the application down" */
    it("finishes initializing, leaves Okta unmounted and keeps password sign-up working", async () => {
      const port = await closedPort();
      const { auth, config } = buildAuth({ issuerPort: port });

      expect(config[0]?.requireIdTokenVerification).toBe(true);
      const context = await auth.$context;
      expect(context.socialProviders.map((p) => p.id)).not.toContain("okta");

      const oktaSignIn = await startOktaSignIn(auth);
      expect(oktaSignIn.status).toBe(404);

      const passwordSignUp = await signUpWithPassword(auth);
      expect(passwordSignUp.status).toBe(200);
    });
  });

  describe("when the identity provider becomes reachable after startup", () => {
    /** @scenario "Single sign-on comes back once the identity provider is reachable, still verifying ID tokens" */
    it("mounts Okta with a nonce-bound sign-in and refuses a token the JWKS does not sign", async () => {
      const port = await closedPort();
      const { auth, db } = buildAuth({ issuerPort: port, retryDelaysMs: [50] });
      await auth.$context;
      expect((await startOktaSignIn(auth)).status).toBe(404);

      const idp = await startIdentityProvider({ port, publishJwks: true });
      const started = await waitForOktaSignIn(auth);
      expect(started.status).toBe(200);

      const authorizationUrl = new URL(authorizationResponseSchema.parse(await started.json()).url);
      const nonce = authorizationUrl.searchParams.get("nonce");
      expect(nonce).toBeTruthy();

      const code = `code-${randomUUID()}`;
      idp.nonces.set(code, nonce ?? "");
      const callback = new URL(`${BASE_URL}/api/auth/callback/okta`);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "");
      const cookie = started.headers
        .getSetCookie()
        .map((value) => value.split(";", 1)[0])
        .join("; ");
      const response = await auth.handler(
        new Request(callback, { headers: { cookie }, redirect: "manual" }),
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("error=");
      expect(db.account ?? []).toHaveLength(0);
      expect(db.session ?? []).toHaveLength(0);
    });
  });

  describe("when discovery answers without a signing key set", () => {
    /** @scenario "An identity provider whose discovery cannot verify ID tokens is never mounted" */
    it("keeps Okta unmounted rather than accepting unverified ID tokens", async () => {
      const port = await closedPort();
      await startIdentityProvider({ port, publishJwks: false });
      const { auth } = buildAuth({ issuerPort: port });

      const context = await auth.$context;
      expect(context.socialProviders.map((p) => p.id)).not.toContain("okta");
      expect((await startOktaSignIn(auth)).status).toBe(404);
    });
  });
});
