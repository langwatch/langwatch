/**
 * @vitest-environment node
 *
 * The cryptographic boundary underneath Auth0/Okta session AMR. The identity
 * provider is local, but everything being proved is real: OIDC discovery,
 * remote JWKS loading, RS256 signatures, BetterAuth's callback handler and
 * its memory adapter. A rejected token must never reach an Account or Session
 * write, which is the premise the request-scoped claims recorder relies on.
 */

import {
  createSign,
  generateKeyPairSync,
  type KeyObject,
  randomUUID,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

type MemoryDb = Record<string, Record<string, unknown>[]>;

type PublicJwk = JsonWebKey & {
  alg: string;
  kid: string;
  use: string;
};

type TokenVariant =
  | "valid"
  | "wrong-signature"
  | "wrong-issuer"
  | "wrong-audience"
  | "wrong-nonce";

const BASE_URL = "http://localhost:3000";
const PROVIDER_ID = "auth0";
const CLIENT_ID = "auth0-client";
const codes = new Map<string, { nonce: string; variant: TokenVariant }>();
const authorizationResponseSchema = z.object({ url: z.string().url() });

let idp: Server;
let issuer: string;
let signingKey: KeyObject;
let wrongSigningKey: KeyObject;
let publicJwk: PublicJwk;

const json = (response: import("node:http").ServerResponse, value: unknown) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const base64urlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const signedIdToken = ({
  nonce,
  variant,
}: {
  nonce: string;
  variant: TokenVariant;
}): string => {
  const now = Math.floor(Date.now() / 1_000);
  const header = base64urlJson({ alg: "RS256", kid: "test-key", typ: "JWT" });
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
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  const signature = signer
    .sign(variant === "wrong-signature" ? wrongSigningKey : signingKey)
    .toString("base64url");
  return `${input}.${signature}`;
};

const startIdentityProvider = async (): Promise<void> => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wrongKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  signingKey = keys.privateKey;
  wrongSigningKey = wrongKeys.privateKey;
  publicJwk = {
    ...keys.publicKey.export({ format: "jwk" }),
    alg: "RS256",
    kid: "test-key",
    use: "sig",
  };

  idp = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      json(response, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
      return;
    }
    if (url.pathname === "/jwks") {
      json(response, { keys: [publicJwk] });
      return;
    }
    if (url.pathname === "/token") {
      const body = await new Promise<string>((resolve) => {
        let value = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          value += chunk;
        });
        request.on("end", () => resolve(value));
      });
      const code = new URLSearchParams(body).get("code") ?? "";
      const token = codes.get(code);
      if (!token) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      json(response, {
        access_token: `access-${code}`,
        token_type: "Bearer",
        expires_in: 300,
        id_token: signedIdToken(token),
      });
      return;
    }
    if (url.pathname === "/userinfo") {
      json(response, {
        sub: "auth0|sam",
        email: "sam@acme.test",
        email_verified: true,
        name: "Sam",
      });
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  const address = idp.address();
  if (!address || typeof address === "string") {
    throw new Error("The local identity provider did not bind a TCP port");
  }
  const { port } = address satisfies AddressInfo;
  issuer = `http://127.0.0.1:${port}`;
};

const cookiesFor = (response: Response): string => {
  return response.headers
    .getSetCookie()
    .filter(Boolean)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
};

const applyResponseCookies = (
  cookieHeader: string,
  response: Response,
): string => {
  const jar = new Map<string, string>();
  for (const pair of cookieHeader.split("; ").filter(Boolean)) {
    const separator = pair.indexOf("=");
    if (separator < 1) {
      continue;
    }
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }

  for (const setCookie of response.headers.getSetCookie()) {
    const [pair] = setCookie.split(";", 1);
    if (!pair) {
      continue;
    }
    const separator = pair.indexOf("=");
    if (separator < 1) {
      continue;
    }
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const deletesCookie =
      value === "" || /(?:^|;)\s*max-age=0(?:;|$)/i.test(setCookie);
    if (deletesCookie) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
};

const buildHarness = () => {
  const db: MemoryDb = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: PROVIDER_ID,
            clientId: CLIENT_ID,
            clientSecret: "auth0-secret",
            discoveryUrl: `${issuer}/.well-known/openid-configuration`,
            accountIssuer: "local:oauth:auth0",
            redirectURI: `${BASE_URL}/api/auth/callback/${PROVIDER_ID}`,
            scopes: ["openid", "email", "profile"],
            requireIdTokenVerification: true,
          },
        ],
      }),
    ],
  });
  return { auth, db };
};

const beginCallback = async ({
  auth,
  variant,
  assertStarted,
}: {
  auth: ReturnType<typeof buildHarness>["auth"];
  variant: TokenVariant;
  assertStarted: (input: {
    status: number;
    state: string | null;
    nonce: string | null;
  }) => void;
}) => {
  const started = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: PROVIDER_ID, disableRedirect: true }),
    }),
  );
  const body = authorizationResponseSchema.parse(await started.json());
  const authorizationUrl = new URL(body.url);
  const state = authorizationUrl.searchParams.get("state");
  const nonce = authorizationUrl.searchParams.get("nonce");
  assertStarted({ status: started.status, state, nonce });

  const code = `code-${variant}-${randomUUID()}`;
  codes.set(code, { nonce: nonce ?? "", variant });
  const callback = new URL(`${BASE_URL}/api/auth/callback/${PROVIDER_ID}`);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state ?? "");
  const cookie = cookiesFor(started);

  return {
    cookie,
    callback: ({
      cookieOverride = cookie,
      omitState = false,
      stateOverride,
    }: {
      cookieOverride?: string;
      omitState?: boolean;
      stateOverride?: string;
    } = {}) => {
      const requestedCallback = new URL(callback);
      if (omitState) {
        requestedCallback.searchParams.delete("state");
      } else if (stateOverride) {
        requestedCallback.searchParams.set("state", stateOverride);
      }
      return auth.handler(
        new Request(requestedCallback, {
          headers: { cookie: cookieOverride },
          redirect: "manual",
        }),
      );
    },
  };
};

beforeAll(startIdentityProvider);

afterAll(async () => {
  await new Promise<void>((resolve) => idp.close(() => resolve()));
});

describe("generic OAuth's verified ID-token boundary", () => {
  /** @scenario A valid signed Auth0 callback reaches account and session creation */
  it("lets a valid signed callback reach Account and Session writes", async () => {
    const { auth, db } = buildHarness();
    const flow = await beginCallback({
      auth,
      variant: "valid",
      assertStarted: ({ status, state, nonce }) => {
        expect(status).toBe(200);
        expect(state).toBeTruthy();
        expect(nonce).toBeTruthy();
      },
    });

    const response = await flow.callback();

    expect(response.status).toBe(302);
    expect(db.account).toHaveLength(1);
    expect(db.session).toHaveLength(1);
  });

  /** @scenario Invalid Auth0 proof never reaches account or session creation */
  it.each<TokenVariant>([
    "wrong-signature",
    "wrong-issuer",
    "wrong-audience",
    "wrong-nonce",
  ])("rejects %s before any Account or Session write", async (variant) => {
    const { auth, db } = buildHarness();
    const flow = await beginCallback({
      auth,
      variant,
      assertStarted: ({ status, state, nonce }) => {
        expect(status).toBe(200);
        expect(state).toBeTruthy();
        expect(nonce).toBeTruthy();
      },
    });

    const response = await flow.callback();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain(
      "error=unable_to_get_user_info",
    );
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  /** @scenario Invalid callback state reaches no account or session write */
  it.each([
    ["missing", { omitState: true }],
    ["mismatched", { stateOverride: "attacker-state" }],
  ])("rejects %s callback state before any Account or Session write", async (_name, request) => {
    const { auth, db } = buildHarness();
    const flow = await beginCallback({
      auth,
      variant: "valid",
      assertStarted: ({ status, state, nonce }) => {
        expect(status).toBe(200);
        expect(state).toBeTruthy();
        expect(nonce).toBeTruthy();
      },
    });

    const response = await flow.callback(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=");
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  /** @scenario Replaying an accepted callback creates no additional account or session */
  it("rejects a replay after applying the callback response cookies", async () => {
    const { auth, db } = buildHarness();
    const flow = await beginCallback({
      auth,
      variant: "valid",
      assertStarted: ({ status, state, nonce }) => {
        expect(status).toBe(200);
        expect(state).toBeTruthy();
        expect(nonce).toBeTruthy();
      },
    });
    const accepted = await flow.callback();
    expect(db.account).toHaveLength(1);
    expect(db.session).toHaveLength(1);

    const browserCookies = applyResponseCookies(flow.cookie, accepted);
    const replayed = await flow.callback({ cookieOverride: browserCookies });

    expect(replayed.status).toBe(302);
    expect(replayed.headers.get("location")).toContain("error=");
    expect(db.account).toHaveLength(1);
    expect(db.session).toHaveLength(1);
  });
});
