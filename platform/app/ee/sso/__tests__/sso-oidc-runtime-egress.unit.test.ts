import { generateKeyPairSync, sign } from "node:crypto";

import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createSsoOidcFetch, type OidcTransport } from "../sso-oidc-fetch";

const app = "https://langwatch.example.test";
const issuer = "https://tenant-idp.example.test";
const privateOrigin = "https://internal.example.test";
const endpoints = ["discovery", "token", "jwks", "userinfo"] as const;
type Endpoint = (typeof endpoints)[number];
let token: string;
let jwks: { keys: unknown[] };

beforeAll(() => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  jwks = {
    keys: [
      {
        ...keys.publicKey.export({ format: "jwk" }),
        kid: "key",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "key" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: "client",
      sub: "subject",
      iat: issuedAt,
      exp: issuedAt + 300,
      email: "member@tenant.example.test",
      email_verified: true,
      name: "Member",
    }),
  ).toString("base64url");
  const signed = `${header}.${payload}`;
  token = `${signed}.${sign("sha256", Buffer.from(signed), keys.privateKey).toString("base64url")}`;
});

function ceremony(blocked: Endpoint | null, blockedOrigin = privateOrigin) {
  const urlFor = (endpoint: Endpoint) =>
    `${endpoint === blocked ? blockedOrigin : issuer}/${endpoint}`;
  const fetchImpl = vi.fn<OidcTransport>(async (url) => {
    switch (new URL(url).pathname) {
      case "/discovery":
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: urlFor("token"),
          jwks_uri: urlFor("jwks"),
          userinfo_endpoint: urlFor("userinfo"),
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
        });
      case "/token":
        return Response.json({
          access_token: "access",
          token_type: "Bearer",
          id_token: token,
        });
      case "/jwks":
        return Response.json(jwks);
      case "/userinfo":
        return Response.json({
          sub: "subject",
          email: "member@tenant.example.test",
          email_verified: true,
          name: "Member",
        });
      default:
        throw new Error("unexpected endpoint");
    }
  });
  const resolveHost = vi.fn(async (host: string) => [
    host === new URL(blockedOrigin).hostname ? "127.0.0.1" : "93.184.216.34",
  ]);
  const database: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: app,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(database),
    // Deliberately browser-trusted: this must not exempt the runtime transport.
    trustedOrigins: [app, issuer, privateOrigin],
    plugins: [
      sso({
        oidcFetch: createSsoOidcFetch({
          dialableInternalOrigins: [],
          resolveHost,
          fetchImpl,
        }),
        defaultSSO: [
          {
            providerId: "connection",
            domain: "tenant.example.test",
            oidcConfig: {
              issuer,
              pkce: true,
              allowIdpInitiated: true,
              clientId: "client",
              clientSecret: "secret",
              discoveryEndpoint: urlFor("discovery"),
            },
          },
        ],
      }),
    ],
  });
  const start = () =>
    auth.handler(
      new Request(`${app}/api/auth/sign-in/sso`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "connection",
          callbackURL: `${app}/dashboard`,
        }),
      }),
    );
  const finish = async (started: Response) => {
    const payload = z.object({ url: z.string() }).parse(await started.json());
    const state = new URL(payload.url).searchParams.get("state");
    const cookie = started.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    return auth.handler(
      new Request(`${app}/api/auth/sso/callback/connection?code=code&state=${state}`, {
        headers: { cookie },
      }),
    );
  };
  const bounce = () =>
    auth.handler(new Request(`${app}/api/auth/sso/callback/connection?code=unsolicited`));
  return { start, finish, bounce, fetchImpl, database, resolveHost };
}

describe("the SSO plugin's runtime egress boundary", () => {
  /** @scenario "Runtime OIDC requests enforce the public-address policy independently of browser trust" */
  it.each(
    endpoints.flatMap((endpoint) => [
      { endpoint, blockedOrigin: privateOrigin },
      { endpoint, blockedOrigin: app },
    ]),
  )(
    "refuses trusted $endpoint requests to $blockedOrigin before transport",
    async ({ endpoint, blockedOrigin }) => {
      const flow = ceremony(endpoint, blockedOrigin);
      const started = await flow.start();
      if (endpoint === "discovery") {
        expect(started.status).toBeGreaterThanOrEqual(400);
      } else {
        expect(started.status).toBe(200);
        const callback = await flow.finish(started);
        expect(callback.headers.get("location")).toContain("error=");
      }
      expect(flow.resolveHost).toHaveBeenCalledWith(new URL(blockedOrigin).hostname);
      expect(flow.fetchImpl.mock.calls.some(([url]) => url.startsWith(blockedOrigin))).toBe(false);
      expect(flow.database.session).toHaveLength(0);
    },
  );

  it("completes public discovery, token exchange, signing-key and userinfo requests", async () => {
    const flow = ceremony(null);
    const started = await flow.start();
    expect(started.status).toBe(200);
    const callback = await flow.finish(started);
    expect(callback.headers.get("location")).toBe(`${app}/dashboard`);
    expect(flow.database.session).toHaveLength(1);
    expect(
      flow.fetchImpl.mock.calls.filter(([url]) => new URL(url).pathname === "/discovery"),
    ).toHaveLength(2);
    expect(new Set(flow.fetchImpl.mock.calls.map(([url]) => new URL(url).pathname))).toEqual(
      new Set(endpoints.map((endpoint) => `/${endpoint}`)),
    );
  });
  it.each([true, false])(
    "applies guarded discovery to IdP-initiated sign-in (public: %s)",
    async (isPublic) => {
      const flow = ceremony(isPublic ? null : "discovery");
      const response = await flow.bounce();
      if (isPublic) {
        expect(response.headers.get("location")).toContain(`${issuer}/authorize`);
        expect(flow.fetchImpl).toHaveBeenCalledTimes(1);
      } else {
        expect(response.headers.get("location")).toContain("error=");
        expect(flow.fetchImpl).not.toHaveBeenCalled();
      }
      expect(flow.resolveHost).toHaveBeenCalled();
      expect(flow.database.session).toHaveLength(0);
    },
  );
});
