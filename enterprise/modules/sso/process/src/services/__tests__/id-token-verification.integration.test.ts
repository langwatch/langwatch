// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The verified ID-token boundary under Auth0 session evidence, over the config this module
 * builds. Only the identity provider is local; discovery, JWKS, RS256 and the callback are real.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */
import { createSign, generateKeyPairSync, type KeyObject, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { buildGenericOAuthConfigs } from "@langwatch/enterprise-sso-contract/sign-in-providers";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

type TokenVariant =
  | "valid"
  | "unsigned"
  | "wrong-signature"
  | "wrong-issuer"
  | "wrong-audience"
  | "wrong-nonce";

const BASE_URL = "http://localhost:3000";
const CLIENT_ID = "auth0-client";
const codes = new Map<string, { nonce: string; variant: TokenVariant }>();
const authorizationResponseSchema = z.object({ url: z.string().url() });

let idp: Server;
let issuer: string;
let signingKey: KeyObject;
let wrongSigningKey: KeyObject;
let publicJwk: JsonWebKey & { alg: string; kid: string; use: string };
let publishesSigningKeys = true;

const json = (response: ServerResponse, value: unknown) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const base64urlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const idTokenFor = ({ nonce, variant }: { nonce: string; variant: TokenVariant }): string => {
  const now = Math.floor(Date.now() / 1_000);
  const alg = variant === "unsigned" ? "none" : "RS256";
  const header = base64urlJson({ alg, kid: "test-key", typ: "JWT" });
  const payload = base64urlJson({
    iss: variant === "wrong-issuer" ? `${issuer}/attacker` : issuer,
    aud: variant === "wrong-audience" ? "another-client" : CLIENT_ID,
    sub: "auth0|sam",
    email: "sam@acme.test",
    email_verified: true,
    nonce: variant === "wrong-nonce" ? "another-nonce" : nonce,
    amr: ["pwd", "otp"],
    iat: now,
    exp: now + 300,
  });
  const input = `${header}.${payload}`;
  if (variant === "unsigned") return `${input}.`;

  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  const key = variant === "wrong-signature" ? wrongSigningKey : signingKey;
  return `${input}.${signer.sign(key).toString("base64url")}`;
};

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let value = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (value += chunk));
    request.on("end", () => resolve(value));
  });

const startIdentityProvider = async (): Promise<void> => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  signingKey = keys.privateKey;
  wrongSigningKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  publicJwk = {
    ...keys.publicKey.export({ format: "jwk" }),
    alg: "RS256",
    kid: "test-key",
    use: "sig",
  };

  idp = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(response, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        ...(publishesSigningKeys ? { jwks_uri: `${issuer}/jwks` } : {}),
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }
    if (url.pathname === "/jwks") return json(response, { keys: [publicJwk] });
    if (url.pathname === "/token") {
      const code = new URLSearchParams(await readBody(request)).get("code") ?? "";
      const token = codes.get(code);
      if (!token) {
        response.writeHead(400, { "content-type": "application/json" });
        return response.end(JSON.stringify({ error: "invalid_grant" }));
      }
      return json(response, {
        access_token: `access-${code}`,
        token_type: "Bearer",
        expires_in: 300,
        id_token: idTokenFor(token),
      });
    }
    if (url.pathname === "/userinfo") {
      return json(response, {
        sub: "auth0|sam",
        email: "sam@acme.test",
        email_verified: true,
        name: "Sam",
      });
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  const address = idp.address();
  if (!address || typeof address === "string")
    throw new Error("the identity provider bound no port");
  issuer = `http://127.0.0.1:${(address satisfies AddressInfo).port}`;
};

/** The deployment's own Auth0 config, pointed at the local provider's discovery document. */
const buildHarness = () => {
  const built = buildGenericOAuthConfigs({
    provider: "auth0",
    baseUrl: BASE_URL,
    auth0ClientId: CLIENT_ID,
    auth0ClientSecret: "auth0-secret",
    auth0Issuer: "https://tenant.eu.auth0.com",
  }).find((config) => config.providerId === "auth0");
  if (!built) throw new Error("the deployment built no auth0 provider");

  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    account: { accountLinking: { enabled: true } },
    plugins: [
      genericOAuth({
        config: [{ ...built, discoveryUrl: `${issuer}/.well-known/openid-configuration` }],
      }),
    ],
  });
  return { auth, db };
};

const callbackWith = async ({
  auth,
  variant,
  state: stateOverride,
}: {
  auth: ReturnType<typeof buildHarness>["auth"];
  variant: TokenVariant;
  state?: string | null;
}) => {
  const started = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "auth0", disableRedirect: true }),
    }),
  );
  const authorization = new URL(authorizationResponseSchema.parse(await started.json()).url);
  const nonce = authorization.searchParams.get("nonce");
  expect(nonce).toBeTruthy();

  const code = `code-${variant}-${randomUUID()}`;
  codes.set(code, { nonce: nonce ?? "", variant });
  const callback = new URL(`${BASE_URL}/api/auth/callback/auth0`);
  callback.searchParams.set("code", code);
  const state =
    stateOverride === undefined ? authorization.searchParams.get("state") : stateOverride;
  if (state !== null) callback.searchParams.set("state", state);
  const cookie = started.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");

  return auth.handler(new Request(callback, { headers: { cookie }, redirect: "manual" }));
};

beforeAll(startIdentityProvider);

afterAll(async () => {
  await new Promise<void>((resolve) => idp.close(() => resolve()));
});

describe("the Auth0 provider this deployment builds", () => {
  /** @scenario A valid signed Auth0 callback reaches account and session creation */
  it("lets a valid signed callback reach Account and Session writes", async () => {
    const { auth, db } = buildHarness();

    const response = await callbackWith({ auth, variant: "valid" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).not.toContain("error=");
    expect(db.account).toHaveLength(1);
    expect(db.account?.[0]?.issuer).toBe("local:oauth:auth0");
    expect(db.session).toHaveLength(1);
  });

  /** @scenario Invalid Auth0 proof never reaches account or session creation */
  it.each<TokenVariant>([
    "unsigned",
    "wrong-signature",
    "wrong-issuer",
    "wrong-audience",
    "wrong-nonce",
  ])("refuses a %s token before any Account or Session write", async (variant) => {
    const { auth, db } = buildHarness();

    const response = await callbackWith({ auth, variant });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=unable_to_get_user_info");
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  /** @scenario Supported enterprise providers require ID-token verification */
  it("refuses to sign in at all when discovery publishes no signing keys to verify with", async () => {
    publishesSigningKeys = false;
    try {
      const { auth, db } = buildHarness();

      await expect(callbackWith({ auth, variant: "unsigned" })).rejects.toThrow(
        "requires verified ID tokens",
      );
      expect(db.account).toHaveLength(0);
      expect(db.session).toHaveLength(0);
    } finally {
      publishesSigningKeys = true;
    }
  });

  /** @scenario Invalid callback state reaches no account or session write */
  it.each([
    ["missing", null],
    ["mismatched", "attacker-state"],
  ])("refuses %s callback state before any Account or Session write", async (_name, state) => {
    const { auth, db } = buildHarness();

    const response = await callbackWith({ auth, variant: "valid", state });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=");
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });
});
