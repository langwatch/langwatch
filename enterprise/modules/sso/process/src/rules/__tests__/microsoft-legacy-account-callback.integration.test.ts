// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * A pre-3.17 Azure AD account signing in through better-auth's own Microsoft callback, with the
 * provider this module builds. It pins the ordering the account move depends on: better-auth
 * calls `mapProfileToUser` for an existing user before it looks the account up. The move itself
 * is identity's, stood in for here over the memory rows (specs/auth/azure-ad-account-upgrade.feature).
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildSocialProviders } from "../sign-in-providers.rules.ts";

const BASE_URL = "http://localhost:3000";
const CLIENT_ID = "azure-client";
const TENANT = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const LEGACY_ISSUER = "local:oauth:microsoft";
const USER = "user-sam";
const EMAIL = "sam@acme.test";
const SUB = "pairwise-sub";
const OID = "object-id";

const authorizationResponseSchema = z.object({ url: z.string().url() });
const rowSchema = z.record(z.string(), z.unknown());
type Row = z.infer<typeof rowSchema>;
type MemoryDb = { user: Row[]; session: Row[]; account: Row[]; verification: Row[] };

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** An id token as Microsoft issues it, minus the signature the code exchange does not check. */
const idToken = () => {
  const now = Math.floor(Date.now() / 1_000);
  return `${base64url({ alg: "none", typ: "JWT" })}.${base64url({
    iss: ISSUER,
    aud: CLIENT_ID,
    tid: TENANT,
    sub: SUB,
    oid: OID,
    email: EMAIL,
    name: "Sam Acme",
    iat: now,
    exp: now + 300,
  })}.`;
};

const realFetch = globalThis.fetch;

/** Microsoft's side of the sign-in; everything else goes out as usual. */
const stubMicrosoft = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname === "login.microsoftonline.com" && url.pathname.endsWith("/token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: idToken(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.hostname === "graph.microsoft.com") return new Response(null, { status: 404 });
    return realFetch(input, init);
  });

/** The rows a 3.16 install carries for this user: the account under `(legacy issuer, sub)`. */
function legacyRows(): MemoryDb {
  const at = new Date();
  return {
    user: [
      { id: USER, email: EMAIL, name: "Sam", emailVerified: true, createdAt: at, updatedAt: at },
    ],
    session: [],
    account: [
      {
        id: "acc-microsoft",
        userId: USER,
        providerId: "microsoft",
        issuer: LEGACY_ISSUER,
        accountId: SUB,
        createdAt: at,
        updatedAt: at,
      },
    ],
    verification: [],
  };
}

/** identity's move, over these rows: the legacy row takes the token's issuer and oid. */
const moveOver = (db: MemoryDb) => async (profile: Record<string, unknown>) => {
  const legacy = db.account.find(
    (row) => row.accountId === profile.sub && row.issuer === LEGACY_ISSUER,
  );
  if (!legacy) return;
  legacy.issuer = profile.iss;
  legacy.accountId = profile.oid;
};

const deployment = (
  db: MemoryDb,
  onMicrosoftProfile: (profile: Record<string, unknown>) => Promise<void>,
) =>
  betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    rateLimit: { enabled: false },
    socialProviders: buildSocialProviders(
      {
        provider: "azure-ad",
        azureAdClientId: CLIENT_ID,
        azureAdClientSecret: "azure-secret",
        azureAdTenantId: TENANT,
      },
      { onMicrosoftProfile },
    ),
  });

/** Starts the sign-in the way the sign-in page does, then returns to the callback with a code. */
async function signInWithMicrosoft(auth: ReturnType<typeof deployment>): Promise<Response> {
  const started = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "microsoft",
        callbackURL: `${BASE_URL}/`,
        disableRedirect: true,
      }),
    }),
  );
  const authorizationUrl = new URL(authorizationResponseSchema.parse(await started.json()).url);
  const callback = new URL(`${BASE_URL}/api/auth/callback/microsoft`);
  callback.searchParams.set("code", "code-1");
  callback.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "");
  const cookie = started.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return auth.handler(new Request(callback, { headers: { cookie }, redirect: "manual" }));
}

beforeEach(() => {
  stubMicrosoft();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given a user whose Microsoft account is still on its pre-3.17 key", () => {
  describe("when they sign in through the Microsoft callback", () => {
    /** @scenario "A pre-3.17 Azure AD user signs in through the Microsoft callback onto their existing account" */
    it("moves the account before the lookup and signs in the existing user", async () => {
      const db = legacyRows();

      const response = await signInWithMicrosoft(deployment(db, moveOver(db)));

      expect(response.headers.get("location")).toBe(`${BASE_URL}/`);
      expect(db.user.map((row) => row.id)).toEqual([USER]);
      expect(db.account).toEqual([
        expect.objectContaining({ id: "acc-microsoft", issuer: ISSUER, accountId: OID }),
      ]);
      expect(db.session.filter((row) => row.userId === USER)).toHaveLength(1);
    });
  });

  describe("when the account move fails", () => {
    /** @scenario "A sign-in whose account move fails is stopped instead of reaching account linking" */
    it("stops the sign-in, leaves the account on its old key, and a retry signs in", async () => {
      const db = legacyRows();
      const failing = async () => {
        throw new Error("connection terminated");
      };

      const response = await signInWithMicrosoft(deployment(db, failing));

      expect(response.headers.get("location")).not.toBe(`${BASE_URL}/`);
      expect(db.user).toHaveLength(1);
      expect(db.account).toEqual([
        expect.objectContaining({ id: "acc-microsoft", issuer: LEGACY_ISSUER, accountId: SUB }),
      ]);
      expect(db.session).toEqual([]);

      const retried = await signInWithMicrosoft(deployment(db, moveOver(db)));
      expect(retried.headers.get("location")).toBe(`${BASE_URL}/`);
      expect(db.session.filter((row) => row.userId === USER)).toHaveLength(1);
    });
  });
});
