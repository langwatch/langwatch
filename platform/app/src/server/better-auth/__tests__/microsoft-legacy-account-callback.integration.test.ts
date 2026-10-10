/**
 * @vitest-environment node
 *
 * A pre-3.17 Azure AD account signing in through better-auth's own Microsoft
 * callback. The provider comes from the deployment's builder
 * (`buildSocialProviders`) with the rekey the identity runtime wires into it
 * (`microsoftProfileRekey` over Postgres), and the account lives in Postgres
 * under the key an older release left it on. The only stand-in is the
 * network: Microsoft's token endpoint answers with an id token, and Graph has
 * no profile photo.
 *
 * What it pins is the ordering the rekey depends on: better-auth calls
 * `mapProfileToUser` for an EXISTING user's callback, before it looks the
 * account up. Had the rekey run after the lookup, the lookup would miss the
 * legacy row and fall through to account linking, which refuses this token
 * (`account_not_linked`) or, where linking accepts it, writes a second
 * Account row; the redirect and the single, same-id row rule out both.
 *
 * @see specs/auth/azure-ad-account-upgrade.feature
 */

import {
  LEGACY_MICROSOFT_ISSUER,
  microsoftProfileRekey,
} from "@ee/sso/microsoft-account-rekey";
import { buildSocialProviders } from "@ee/sso/providers";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prisma } from "~/server/db";
import { handleAuthRequest } from "~/server/routes/auth-request";
import { models } from "../config/models";

const BASE_URL = "http://localhost:3000";
const CLIENT_ID = "azure-client";
const TENANT = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

const ns = `mscallback-${nanoid(8).toLowerCase()}`;
const USER = `${ns}-user`;
const EMAIL = `${ns}@acme.test`;
const ACCOUNT = `${ns}-account`;
const IDENTIFIER = `${ns}-identifier`;
const SUB = `${ns}-sub`;
const OID = `${ns}-oid`;

const authorizationResponseSchema = z.object({ url: z.string().url() });

const base64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** An id token as Microsoft issues it, minus the signature: better-auth's
 *  Microsoft provider decodes the code-exchange token without verifying it. */
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
    const url = new URL(
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url,
    );
    if (
      url.hostname === "login.microsoftonline.com" &&
      url.pathname === `/${TENANT}/oauth2/v2.0/token`
    ) {
      return new Response(
        JSON.stringify({
          access_token: `access-${nanoid()}`,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile email User.Read offline_access",
          id_token: idToken(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.hostname === "graph.microsoft.com") {
      return new Response(null, { status: 404 });
    }
    return realFetch(input, init);
  });

const buildAuth = ({
  rekey = microsoftProfileRekey({ prisma }),
}: {
  rekey?: (profile: Record<string, unknown>) => Promise<void>;
} = {}) =>
  betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    ...models(),
    rateLimit: { enabled: false },
    socialProviders: buildSocialProviders(
      {
        NEXTAUTH_PROVIDER: "azure-ad",
        NEXTAUTH_URL: BASE_URL,
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: undefined,
        GITHUB_CLIENT_ID: undefined,
        GITHUB_CLIENT_SECRET: undefined,
        GITLAB_CLIENT_ID: undefined,
        GITLAB_CLIENT_SECRET: undefined,
        AZURE_AD_CLIENT_ID: CLIENT_ID,
        AZURE_AD_CLIENT_SECRET: "azure-secret",
        AZURE_AD_TENANT_ID: TENANT,
      },
      { onMicrosoftProfile: rekey },
    ),
  });

/** The rows a 3.16 install carries for this user after upgrading: the
 *  account under `(local:oauth:microsoft, sub)`, and the identifier the
 *  backfill adopted from it. */
async function seedLegacyAccount() {
  await prisma.user.create({
    data: { id: USER, email: EMAIL, name: "Sam", emailVerified: true },
  });
  await prisma.account.create({
    data: {
      id: ACCOUNT,
      userId: USER,
      provider: "microsoft",
      issuer: LEGACY_MICROSOFT_ISSUER,
      providerAccountId: SUB,
    },
  });
  await prisma.identifier.create({
    data: {
      id: IDENTIFIER,
      userId: USER,
      provider: "azure-ad",
      providerId: "microsoft",
      issuer: LEGACY_MICROSOFT_ISSUER,
      providerAccountId: SUB,
      accountId: ACCOUNT,
      value: EMAIL,
      state: "VERIFIED",
      attachedAt: new Date(),
    },
  });
}

async function cleanUp() {
  const users = await prisma.user.findMany({
    where: { email: EMAIL },
    select: { id: true },
  });
  const userIds = [USER, ...users.map((user) => user.id)];
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.identifier.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/** Starts the sign-in the way the sign-in page does, then comes back to the
 *  callback with Microsoft's code and the state that sign-in minted. */
async function signInWithMicrosoft(auth: ReturnType<typeof buildAuth>) {
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
  if (started.status !== 200) {
    throw new Error(`sign-in did not start: ${started.status}`);
  }
  const authorizationUrl = new URL(
    authorizationResponseSchema.parse(await started.json()).url,
  );
  // Azure sends the browser back to the redirect URI the sign-in named,
  // which is the path registered with Azure, and the auth route hands it on.
  const callback = new URL(
    authorizationUrl.searchParams.get("redirect_uri") ?? "",
  );
  callback.searchParams.set("code", `code-${nanoid()}`);
  callback.searchParams.set(
    "state",
    authorizationUrl.searchParams.get("state") ?? "",
  );
  const cookie = started.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  // Through the same request handling the auth route uses.
  return handleAuthRequest({
    request: new Request(callback, { headers: { cookie }, redirect: "manual" }),
    handler: (request) => auth.handler(request),
  });
}

beforeEach(async () => {
  await cleanUp();
  await seedLegacyAccount();
  stubMicrosoft();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanUp();
});

describe("given Microsoft sign-in configured by the deployment", () => {
  describe("when a sign-in starts", () => {
    /** @scenario "Microsoft sign-in sends the redirect URI registered with Azure" */
    it("names /api/auth/callback/azure-ad as the redirect URI", async () => {
      const started = await buildAuth().handler(
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
      const authorizationUrl = new URL(
        authorizationResponseSchema.parse(await started.json()).url,
      );

      expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
        `${BASE_URL}/api/auth/callback/azure-ad`,
      );
    });
  });
});

describe("given a user whose Microsoft account is still on its pre-3.17 key", () => {
  describe("when they sign in through the Microsoft callback", () => {
    /** @scenario "A pre-3.17 Azure AD user signs in through the Microsoft callback onto their existing account" */
    it("moves the account onto the token's issuer and oid and signs in the existing user", async () => {
      const response = await signInWithMicrosoft(buildAuth());

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(`${BASE_URL}/`);

      expect(
        await prisma.user.findMany({
          where: { email: EMAIL },
          select: { id: true },
        }),
      ).toEqual([{ id: USER }]);
      expect(
        await prisma.account.findMany({
          where: { userId: USER },
          select: {
            id: true,
            provider: true,
            issuer: true,
            providerAccountId: true,
          },
        }),
      ).toEqual([
        {
          id: ACCOUNT,
          provider: "microsoft",
          issuer: ISSUER,
          providerAccountId: OID,
        },
      ]);
      expect(
        await prisma.identifier.findUnique({
          where: { id: IDENTIFIER },
          select: { issuer: true, providerAccountId: true, accountId: true },
        }),
      ).toEqual({ issuer: ISSUER, providerAccountId: OID, accountId: ACCOUNT });
      expect(await prisma.session.count({ where: { userId: USER } })).toBe(1);
    });
  });

  describe("when the account move fails", () => {
    /** @scenario "A sign-in whose account move fails is stopped instead of reaching account linking" */
    it("stops the sign-in and leaves the account on its old key", async () => {
      const failingRekey = microsoftProfileRekey({
        prisma: {
          $transaction: async () => {
            throw new Error("connection terminated");
          },
        } as never,
      });

      const response = await signInWithMicrosoft(
        buildAuth({ rekey: failingRekey }),
      );

      expect(response.headers.get("location")).not.toBe(`${BASE_URL}/`);
      expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
      expect(
        await prisma.account.findMany({
          where: { userId: USER },
          select: { id: true, issuer: true, providerAccountId: true },
        }),
      ).toEqual([
        {
          id: ACCOUNT,
          issuer: LEGACY_MICROSOFT_ISSUER,
          providerAccountId: SUB,
        },
      ]);
      expect(await prisma.session.count({ where: { userId: USER } })).toBe(0);

      const retried = await signInWithMicrosoft(buildAuth());
      expect(retried.headers.get("location")).toBe(`${BASE_URL}/`);
      expect(await prisma.session.count({ where: { userId: USER } })).toBe(1);
    });
  });
});
