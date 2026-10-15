// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The ID-token time window over the provider config this module builds. Only the identity
 * provider is local; discovery, JWKS, RS256 verification and the callback are real.
 * Spec: specs/identity/sso-protocol-conditions.feature
 */
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { buildGenericOAuthConfigs } from "../sign-in-providers.rules.ts";

/** Seconds from now, on our clock, for each time claim the token carries. */
interface TokenTimes {
  iat: number;
  exp: number;
  nbf?: number;
}

const BASE_URL = "http://localhost:3000";
const CLIENT_ID = "auth0-client";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...keys.publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: "k",
  use: "sig",
};
const codes = new Map<string, { nonce: string; times: TokenTimes }>();
const authorizationResponseSchema = z.object({ url: z.string().url() });

let idp: Server;
let issuer: string;

const json = (response: ServerResponse, value: unknown) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

const idTokenFor = ({ nonce, times }: { nonce: string; times: TokenTimes }) => {
  const now = Math.floor(Date.now() / 1_000);
  const input = `${encode({ alg: "RS256", kid: "k", typ: "JWT" })}.${encode({
    iss: issuer,
    aud: CLIENT_ID,
    sub: "auth0|sam",
    email: "sam@acme.test",
    email_verified: true,
    nonce,
    iat: now + times.iat,
    exp: now + times.exp,
    ...(times.nbf === undefined ? {} : { nbf: now + times.nbf }),
  })}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(keys.privateKey).toString("base64url")}`;
};

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let value = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (value += chunk));
    request.on("end", () => resolve(value));
  });

beforeAll(async () => {
  idp = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(response, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }
    if (url.pathname === "/jwks") return json(response, { keys: [publicJwk] });
    if (url.pathname === "/token") {
      const token = codes.get(new URLSearchParams(await readBody(request)).get("code") ?? "");
      if (!token) {
        response.writeHead(400, { "content-type": "application/json" });
        return response.end(JSON.stringify({ error: "invalid_grant" }));
      }
      return json(response, {
        access_token: `access-${randomUUID()}`,
        token_type: "Bearer",
        expires_in: 300,
        id_token: idTokenFor(token),
      });
    }
    if (url.pathname === "/userinfo") {
      return json(response, { sub: "auth0|sam", email: "sam@acme.test", email_verified: true });
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  const address = idp.address();
  if (!address || typeof address === "string")
    throw new Error("the identity provider bound no port");
  issuer = `http://127.0.0.1:${(address satisfies AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => idp.close(() => resolve()));
});

/** The deployment's own Auth0 config, pointed at the local provider, answering one callback. */
async function signInWith({ times }: { times: TokenTimes }) {
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
    plugins: [
      genericOAuth({
        config: [{ ...built, discoveryUrl: `${issuer}/.well-known/openid-configuration` }],
      }),
    ],
  });

  const started = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "auth0", disableRedirect: true }),
    }),
  );
  const authorization = new URL(authorizationResponseSchema.parse(await started.json()).url);
  const code = `code-${randomUUID()}`;
  codes.set(code, { nonce: authorization.searchParams.get("nonce") ?? "", times });
  const callback = new URL(`${BASE_URL}/api/auth/callback/auth0`);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
  const cookie = started.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const response = await auth.handler(
    new Request(callback, { headers: { cookie }, redirect: "manual" }),
  );
  expect(response.status).toBe(302);
  const error = new URL(response.headers.get("location") ?? "", BASE_URL).searchParams.get("error");
  return { error, db };
}

describe("given the Auth0 provider this deployment builds", () => {
  describe("when the identity provider's clock is off but the token has not expired on ours", () => {
    /** @scenario "An ID token from an identity provider whose clock is <offset> <direction> is <outcome>" */
    it.each([
      ["30 seconds ahead", { iat: 30, exp: 330 }],
      ["4 minutes behind", { iat: -240, exp: 60 }],
    ])("admits the token from a clock %s", async (_offset, times) => {
      const { error, db } = await signInWith({ times });

      expect(error).toBeNull();
      expect(db.account).toHaveLength(1);
      expect(db.session).toHaveLength(1);
    });
  });

  describe("when the token's validity window lies outside our clock", () => {
    /** @scenario "An ID token from an identity provider whose clock is <offset> <direction> is <outcome>" */
    /** @scenario "An expired ID token is refused before any account or session write" */
    it("refuses a token from a clock 10 minutes behind before any account or session write", async () => {
      const { error, db } = await signInWith({ times: { iat: -600, exp: -300 } });

      expect(error).toBe("unable_to_get_user_info");
      expect(db.account).toHaveLength(0);
      expect(db.session).toHaveLength(0);
    });

    /** @scenario "An ID token not valid until later is refused before any account or session write" */
    it("refuses a token whose not-before time is ten minutes away", async () => {
      const { error, db } = await signInWith({ times: { iat: 0, nbf: 600, exp: 900 } });

      expect(error).toBe("unable_to_get_user_info");
      expect(db.account).toHaveLength(0);
      expect(db.session).toHaveLength(0);
    });
  });
});
