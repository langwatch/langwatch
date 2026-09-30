/**
 * @vitest-environment node
 *
 * Single sign-on onto a password account whose address was never confirmed
 * (specs/identity/sso-link-unconfirmed-local-account.feature).
 *
 * What is real here: Postgres, the composed identity storage adapter, the
 * app's own plugin list, the production assertion gate (`ssoAssertion()`) and
 * the production user resolver (`ssoProvisionedUsers()`), and the plugin's
 * whole OIDC callback. Only the identity provider stands in, as a stubbed
 * `fetch` answering discovery, token and JWKS with a signed id token.
 */

import { PrismaScimSsoUsers } from "@ee/scim/scim-sso-user.prisma.repository";
import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { normalizeErrorCode } from "~/features/auth/logic/signInErrorCodes";
import { identityStorageTransactions } from "~/server/app-layer/identity/identity-storage-transaction.adapter";
import {
  identityStorageAdapter,
  ssoAssertion,
  ssoProvisionedUsers,
} from "~/server/app-layer/identity/runtime";
import { models } from "~/server/better-auth/config/models";
import { plugins } from "~/server/better-auth/config/plugins";
import type { PasskeySignUpRegistration } from "~/server/better-auth/passkey-signup";
import { prisma } from "~/server/db";

const BASE_URL = "http://localhost:3000";
const SUITE = nanoid(8).toLowerCase();
const DOMAIN = `${SUITE}.unconfirmed-link-test.example`;
const IDP = `https://idp-${SUITE}.unconfirmed-link-test.example`;
const CLIENT_ID = "langwatch-test-client";
const organizationIds: string[] = [];
const connectionIds: string[] = [];
const userIds: string[] = [];

let idToken = "";
let jwks: { keys: unknown[] } = { keys: [] };
let realFetch: typeof globalThis.fetch;

const base64url = (input: string | Uint8Array): string =>
  Buffer.from(input as Uint8Array).toString("base64url");

async function mintIdToken(claims: Record<string, unknown>) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", publicKey);
  const header = base64url(
    JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" }),
  );
  const payload = base64url(JSON.stringify(claims));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  );
  idToken = `${header}.${payload}.${base64url(signature)}`;
  jwks = {
    keys: [
      {
        kty: exported.kty,
        n: exported.n,
        e: exported.e,
        alg: "RS256",
        kid: "test",
        use: "sig",
      },
    ],
  };
}

async function identityProviderAsserts({
  email,
  subject,
  emailVerified,
}: {
  email: string;
  subject: string;
  emailVerified: boolean;
}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  await mintIdToken({
    iss: IDP,
    aud: CLIENT_ID,
    sub: subject,
    email,
    email_verified: emailVerified,
    name: "Provider profile",
    iat: issuedAt,
    exp: issuedAt + 300,
  });
}

/** The resolver as LangWatch Cloud composes it. */
const cloudUsers = PrismaScimSsoUsers.create(identityStorageTransactions, {
  isHosted: () => true,
});

const auth = ({ cloud = false }: { cloud?: boolean } = {}) =>
  betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: identityStorageAdapter(),
    trustedOrigins: [IDP, BASE_URL],
    plugins: plugins({
      backupCodeCount: 10,
      passkeySignUp: () => ({}) as PasskeySignUpRegistration,
      confirmSignUpAddress: async () => undefined,
      ssoAssertion,
      ssoCallbackEvidence: () => ({ recordAuthenticatedSsoAccount: () => {} }),
      ssoProvisionedUsers: cloud ? () => cloudUsers : ssoProvisionedUsers,
    }),
    ...models(),
  });

const respond = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
};

/** A password account created without inbox proof, the way a sign-up on an
 *  installation with no mailer creates it. */
async function unconfirmedPasswordAccount({
  label,
  organizationId,
}: {
  label: string;
  organizationId: string;
}) {
  const email = `${label}-${SUITE}@${DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Password profile",
      emailVerified: false,
    },
  });
  userIds.push(user.id);
  await prisma.account.create({
    data: {
      userId: user.id,
      type: "credential",
      provider: "credential",
      issuer: "credential",
      providerAccountId: user.id,
      password: "hashed-password",
    },
  });
  await prisma.organizationUser.create({
    data: { organizationId, userId: user.id, role: "ADMIN" },
  });
  return { id: user.id, email };
}

async function connection({
  organizationId,
  state,
  domainVerified,
  createdBy,
}: {
  organizationId: string;
  state: "ACTIVE" | "DRAFT";
  domainVerified: boolean;
  createdBy: string;
}): Promise<string> {
  const id = `local_ssoc_${nanoid(16)}`;
  connectionIds.push(id);
  const now = new Date();
  await prisma.ssoConnection.create({
    data: {
      id,
      organizationId,
      type: "oidc",
      state,
      claimedDomains: [DOMAIN],
      approvedDomains: [],
      verifiedDomains: domainVerified ? [DOMAIN] : [],
      domainVerifications: domainVerified
        ? [
            {
              domain: DOMAIN,
              method: "license-token",
              actorId: createdBy,
              verifiedAtMs: now.getTime(),
              proofState: "VERIFIED",
              firstAbsentAtMs: null,
              graceEndsAtMs: null,
              tokenHash: null,
              evidenceRef: "sha256:installation-licence",
              verifier: { type: "user", id: createdBy },
            },
          ]
        : [],
      lapsedDomains: [],
      idpMetadata: {},
      source: "self-serve",
      createdBy,
      occurredAt: now,
      lastEventId: `event-${id}`,
      acceptedAt: now,
      projectionVersion: "1",
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.ssoProvider.create({
    data: {
      id: `ssoprov_${nanoid(12)}`,
      providerId: id,
      issuer: IDP,
      domain: DOMAIN,
      oidcConfig: JSON.stringify({
        clientId: CLIENT_ID,
        clientSecret: "langwatch-test-secret",
        discoveryEndpoint: `${IDP}/.well-known/openid-configuration`,
        authorizationEndpoint: `${IDP}/authorize`,
        tokenEndpoint: `${IDP}/token`,
        jwksEndpoint: `${IDP}/jwks`,
        pkce: true,
        scopes: ["openid", "email", "profile"],
        mapping: { id: "sub", email: "email", emailVerified: "email_verified" },
      }),
    },
  });
  return id;
}

/** One organization, its administrator's unconfirmed password account, and
 *  the organization's one connection, registered by that administrator. */
async function setUp({
  label,
  state,
  domainVerified,
}: {
  label: string;
  state: "ACTIVE" | "DRAFT";
  domainVerified: boolean;
}) {
  const organizationId = `unconfirmed-link-${label}-${SUITE}`;
  organizationIds.push(organizationId);
  await prisma.organization.create({
    data: { id: organizationId, name: label, slug: organizationId },
  });
  const user = await unconfirmedPasswordAccount({ label, organizationId });
  const providerId = await connection({
    organizationId,
    state,
    domainVerified,
    createdBy: user.id,
  });
  return { user, providerId };
}

async function signInThrough(
  providerId: string,
  { cloud = false }: { cloud?: boolean } = {},
) {
  const betterAuthInstance = auth({ cloud });
  const started = await betterAuthInstance.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId,
        callbackURL: `${BASE_URL}/dashboard`,
      }),
    }),
  );
  const authorize = new URL(
    z.object({ url: z.string() }).parse(await started.json()).url,
  );
  const state = authorize.searchParams.get("state");
  const callback = await betterAuthInstance.handler(
    new Request(
      `${BASE_URL}/api/auth/sso/callback/${providerId}?code=test-code&state=${state}`,
      {
        method: "GET",
        redirect: "manual",
        headers: { cookie: started.headers.get("set-cookie") ?? "" },
      },
    ),
  );
  const location = callback.headers.get("location") ?? "";
  const cookie = callback.headers
    .getSetCookie()
    .map((set) => set.split(";")[0])
    .join("; ");
  const session = await betterAuthInstance.api.getSession({
    headers: new Headers({ cookie }),
  });
  const error = new URL(location, BASE_URL).searchParams.get("error");
  return { location, session, error: normalizeErrorCode(error) };
}

async function linkedAccounts(userId: string, providerId: string) {
  return prisma.account.findMany({
    where: { userId, provider: providerId },
    select: { id: true, providerAccountId: true },
  });
}

async function addressConfirmed(userId: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { emailVerified: true },
  });
  return user.emailVerified;
}

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith(`${IDP}/.well-known/openid-configuration`)) {
      return respond({
        issuer: IDP,
        authorization_endpoint: `${IDP}/authorize`,
        token_endpoint: `${IDP}/token`,
        jwks_uri: `${IDP}/jwks`,
      });
    }
    if (url.startsWith(`${IDP}/token`)) {
      return respond({
        access_token: `access-${SUITE}`,
        id_token: idToken,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url.startsWith(`${IDP}/jwks`)) return respond(jwks);
    return realFetch(input, init);
  }) as typeof globalThis.fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await prisma.ssoProvider.deleteMany({
    where: { providerId: { in: connectionIds } },
  });
  for (const userId of userIds) {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.identifier.deleteMany({ where: { userId } });
    await prisma.organizationUser.deleteMany({
      where: { userId, organizationId: { in: organizationIds } },
    });
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.ssoConnection.deleteMany({
    where: { id: { in: connectionIds } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds } },
  });
  await prisma.verificationToken.deleteMany({
    where: {
      OR: connectionIds.map((id) => ({ identifier: { contains: id } })),
    },
  });
});

describe("given a password account whose address was never confirmed", () => {
  describe("when a live connection that verified its domain signs it in with a verified address", () => {
    /** @scenario "A verified domain's identity provider links an unconfirmed password account" */
    it("links the existing account, confirms the address and reuses the binding", async () => {
      const { user, providerId } = await setUp({
        label: "live",
        state: "ACTIVE",
        domainVerified: true,
      });
      const subject = `live-${SUITE}`;
      await identityProviderAsserts({
        email: user.email,
        subject,
        emailVerified: true,
      });

      const first = await signInThrough(providerId);

      expect(first.error).toBeNull();
      expect(first.location).toBe(`${BASE_URL}/dashboard`);
      expect(first.session?.user.id).toBe(user.id);
      expect(await addressConfirmed(user.id)).toBe(true);
      expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
      const binding = await linkedAccounts(user.id, providerId);
      expect(binding).toEqual([
        { id: expect.any(String), providerAccountId: subject },
      ]);

      const repeated = await signInThrough(providerId);

      expect(repeated.session?.user.id).toBe(user.id);
      expect(await linkedAccounts(user.id, providerId)).toEqual(binding);
    });
  });

  describe("when its registrant runs the setup test sign-in on a connection that verified the domain by licence", () => {
    /** @scenario "The setup test sign-in links the registrant's unconfirmed password account" */
    it("links the administrator's existing account and confirms the address", async () => {
      const { user: admin, providerId } = await setUp({
        label: "setup-admin",
        state: "DRAFT",
        domainVerified: true,
      });
      await identityProviderAsserts({
        email: admin.email,
        subject: `setup-admin-${SUITE}`,
        emailVerified: true,
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBeNull();
      expect(result.session?.user.id).toBe(admin.id);
      expect(await addressConfirmed(admin.id)).toBe(true);
      expect(await linkedAccounts(admin.id, providerId)).toHaveLength(1);
    });
  });

  describe("when its registrant runs the setup test sign-in before the domain is verified", () => {
    /** @scenario "An unconfirmed account on a domain the connection has not verified is not linked" */
    it("refuses with the named code and leaves the account as it was", async () => {
      const { user: admin, providerId } = await setUp({
        label: "unverified-domain",
        state: "DRAFT",
        domainVerified: false,
      });
      await identityProviderAsserts({
        email: admin.email,
        subject: `unverified-domain-${SUITE}`,
        emailVerified: true,
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBe("sso_existing_account_unconfirmed");
      expect(result.session).toBeNull();
      expect(await linkedAccounts(admin.id, providerId)).toEqual([]);
      expect(await addressConfirmed(admin.id)).toBe(false);
    });
  });

  describe("when the identity provider does not assert the address is verified", () => {
    /** @scenario "An identity provider that does not vouch for the address does not link an unconfirmed account" */
    it("refuses with the named code and leaves the account as it was", async () => {
      const { user, providerId } = await setUp({
        label: "no-vouch",
        state: "ACTIVE",
        domainVerified: true,
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `no-vouch-${SUITE}`,
        emailVerified: false,
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBe("sso_existing_account_unconfirmed");
      expect(result.session).toBeNull();
      expect(await linkedAccounts(user.id, providerId)).toEqual([]);
      expect(await addressConfirmed(user.id)).toBe(false);
    });
  });

  describe("when a person already bound to the connection signs in again", () => {
    /** @scenario "A person already bound to the connection keeps signing in with an unconfirmed address" */
    it.each([
      {
        label: "returning-unvouched",
        state: "ACTIVE" as const,
        domainVerified: true,
        emailVerified: false,
      },
      {
        label: "returning-unproved",
        state: "DRAFT" as const,
        domainVerified: false,
        emailVerified: true,
      },
    ])("signs $label in to the same account through the binding it already holds", async ({
      label,
      state,
      domainVerified,
      emailVerified,
    }) => {
      const { user, providerId } = await setUp({
        label,
        state,
        domainVerified,
      });
      const subject = `${label}-${SUITE}`;
      await prisma.account.create({
        data: {
          userId: user.id,
          provider: providerId,
          issuer: IDP,
          providerAccountId: subject,
        },
      });
      await identityProviderAsserts({
        email: user.email,
        subject,
        emailVerified,
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBeNull();
      expect(result.session?.user.id).toBe(user.id);
      expect(await linkedAccounts(user.id, providerId)).toHaveLength(1);
    });
  });

  describe("when the installation is LangWatch Cloud", () => {
    /** @scenario "On LangWatch Cloud an unconfirmed password account is not linked by single sign-on" */
    it("keeps better-auth's own refusal and leaves the account as it was", async () => {
      const { user, providerId } = await setUp({
        label: "cloud",
        state: "ACTIVE",
        domainVerified: true,
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `cloud-${SUITE}`,
        emailVerified: true,
      });

      const result = await signInThrough(providerId, { cloud: true });

      expect(result.error).toBe("OAuthAccountNotLinked");
      expect(result.session).toBeNull();
      expect(await linkedAccounts(user.id, providerId)).toEqual([]);
      expect(await addressConfirmed(user.id)).toBe(false);
    });
  });
});
