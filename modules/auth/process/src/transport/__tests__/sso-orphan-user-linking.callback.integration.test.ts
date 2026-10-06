/**
 * @vitest-environment node
 * @see specs/auth/sso-orphan-user-linking.feature
 * The process's real Better Auth transport, answering a callback from a local
 * identity provider that signs RS256 ID tokens, over a User row seeded with no
 * linked Account: linking is ours to enable and the library's to refuse.
 */
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";

import type { SsoMigrationCallbackApi } from "@langwatch/identity-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryAdapter } from "better-auth/adapters/memory";
import { okta } from "better-auth/plugins/generic-oauth";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers.ts";

type MemoryDb = Record<string, Record<string, unknown>[]>;

const BASE_URL = "https://app.langwatch.test";
const CLIENT_ID = "example-client";
const authorizationResponseSchema = z.object({ url: z.string().url() });

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

const json = (response: ServerResponse, value: unknown) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

/** An identity provider that signs the person `email` in with a verified RS256 ID token. */
async function startIdentityProvider({ email }: { email: string }) {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const nonces = new Map<string, string>();
  let issuer = "";

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      json(response, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
      return;
    }
    if (url.pathname === "/jwks") {
      json(response, {
        keys: [
          { ...keys.publicKey.export({ format: "jwk" }), alg: "RS256", kid: "k1", use: "sig" },
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
        sub: `subject-${email}`,
        email,
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
        id_token: `${input}.${signer.sign(keys.privateKey).toString("base64url")}`,
      });
      return;
    }
    if (url.pathname === "/userinfo") {
      json(response, { sub: `subject-${email}`, email, email_verified: true });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the provider has no port");
  issuer = `http://127.0.0.1:${address.port}`;
  return { issuer, nonces };
}

/**
 * The hooks' view of the seeded rows, for an organization that enforces SSO on
 * example.com through the provider this deployment mounts.
 */
function hooksRepositoryOver({ db }: { db: MemoryDb }): BetterAuthHooksRepository {
  const unused = (): never => {
    throw new Error("this repository member is not used by this test");
  };
  return {
    getUserForHooks: async ({ userId }) => {
      const row = db.User?.find((user) => user.id === userId);
      if (!row) throw new Error(`no user ${userId}`);
      return {
        id: userId,
        email: String(row.email),
        name: String(row.name),
        deactivatedAt: null,
        pendingSsoSetup: false,
        signupConfirmationPending: false,
      };
    },
    getOrganizationBySsoDomain: async () => ({
      id: "org_example",
      name: "Example",
      ssoProvider: "okta",
    }),
    countAccountsForUser: async ({ userId }) =>
      db.Account?.filter((account) => account.userId === userId).length ?? 0,
    findFederatedAccountsForUser: async () => [],
    findFederatedAccountsForUsers: async () => [],
    deleteAccounts: unused,
    flagPendingSsoSetup: unused,
    createOrganizationMembership: async () => "created",
    reconcileSsoAccounts: async () => undefined,
    recordLastLogin: async () => undefined,
    countOrgMembershipsForUser: async () => 1,
  };
}

/** Starts the sign-in, lets the provider answer, and returns the callback's response. */
async function completeSignIn({ db, email }: { db: MemoryDb; email: string }) {
  const idp = await startIdentityProvider({ email });
  const transport = betterAuthTransportFor(
    {
      genericOAuthConfigs: [
        {
          ...okta({ clientId: CLIENT_ID, clientSecret: "secret", issuer: idp.issuer }),
          requireIdTokenVerification: true,
        },
      ],
    },
    {
      storage: { adapter: () => memoryAdapter(db) } as never,
      database: hooksRepositoryOver({ db }),
      ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
        decideAccountLink: async () => ({ kind: "not_migrating" }),
        authorizeAndRecordAuthentication: async () => ({ action: "continue" }),
      }),
      federation: {
        federationCapable: () => false,
        resolveSignInMethodPolicy: async () => ({}) as never,
        platformSsoAllowed: async () => true,
      } as never,
    },
  );
  const started = await transport.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "okta", disableRedirect: true }),
    }),
  );
  expect(started.status).toBe(200);
  const authorizationUrl = new URL(authorizationResponseSchema.parse(await started.json()).url);

  const code = `code-${randomUUID()}`;
  idp.nonces.set(code, authorizationUrl.searchParams.get("nonce") ?? "");
  const callback = new URL(`${BASE_URL}/api/auth/callback/okta`);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "");
  const cookie = started.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return transport.handler(new Request(callback, { headers: { cookie }, redirect: "manual" }));
}

function seededDatabase({ email, emailVerified }: { email: string; emailVerified: boolean }) {
  const db: MemoryDb = {
    User: [],
    Session: [],
    Account: [],
    VerificationToken: [],
    ssoProvider: [],
  };
  db.User?.push({
    id: `user-${randomUUID()}`,
    name: "Orphan",
    email,
    emailVerified,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return db;
}

describe("given a User row left by an invite, with no linked Account", () => {
  describe("when its email is verified and the identity provider signs that person in", () => {
    /** @scenario Orphan User row from a prior invite is auto-linked on first SSO sign-in */
    it("links a new Account to that User and signs them in without a linking error", async () => {
      const db = seededDatabase({ email: "alice@example.com", emailVerified: true });

      const response = await completeSignIn({ db, email: "alice@example.com" });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).not.toContain("error");
      expect(db.User).toHaveLength(1);
      expect(db.Account).toHaveLength(1);
      expect(db.Account?.[0]).toMatchObject({ userId: db.User?.[0]?.id });
      expect(db.Session).toHaveLength(1);
      expect(response.headers.getSetCookie().join(";")).toContain("session_token");
    });
  });

  describe("when its email is unverified and the callback returns that address", () => {
    /** @scenario Unverified orphan User cannot be hijacked via OAuth */
    it("refuses the link and redirects to the auth error page", async () => {
      const db = seededDatabase({ email: "bob@example.com", emailVerified: false });

      const response = await completeSignIn({ db, email: "bob@example.com" });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("error=account_not_linked");
      expect(db.Account).toHaveLength(0);
      expect(db.Session).toHaveLength(0);
    });
  });
});
