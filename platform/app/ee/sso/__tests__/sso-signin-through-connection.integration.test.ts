/**
 * @vitest-environment node
 *
 * A sign-in through a single sign-on connection, end to end (see
 * specs/identity/identity-storage-adapter.feature, "Transactions").
 *
 * This is the regression the transaction work exists for. `resolveUser` is
 * configured — it is what checks the connection's proved domains before
 * better-auth links an asserted address onto an existing account, and what
 * makes `trustEmailVerified` defensible — and `@better-auth/sso` refuses to
 * run it at all unless the adapter declares a native transaction. The adapter
 * declared none, so every sign-in through a connection was answered with
 * `SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS` before it reached the
 * identity provider. It had never once succeeded.
 *
 * What is real here: the composed identity storage adapter, Postgres, the
 * app's own plugin list (so the `sso()` options and the `resolveUser`
 * wrapper are production's, not a second set written for the test), and the
 * plugin's whole OIDC callback including the transaction, the provider-row
 * lock and the boundary check.
 *
 * What stands in: the identity provider, as a stubbed `fetch` answering the
 * discovery, token and JWKS endpoints with a signed id token; and the
 * assertion decision, which is the seam "a VERIFIED connection" means at this
 * level — whether a connection's proved domains admit this address is
 * `SsoAssertionService`'s own suite's subject, not this one's.
 */

import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { normalizeErrorCode } from "~/features/auth/logic/signInErrorCodes";
import {
  identityStorageTransactions,
  postgresTransactionOver,
} from "~/server/app-layer/identity/identity-storage-transaction.adapter";
import {
  identityStorageAdapter,
  ssoProvisionedUsers,
} from "~/server/app-layer/identity/runtime";
import { models } from "~/server/better-auth/config/models";
import { plugins } from "~/server/better-auth/config/plugins";
import type { PasskeySignUpRegistration } from "~/server/better-auth/passkey-signup";
import { prisma } from "~/server/db";

const BASE_URL = "http://localhost:3000";
const SUITE = nanoid(8).toLowerCase();
const PROVIDER_ID = `sso-signin-test-${SUITE}`;
const IDP = `https://idp-${SUITE}.sso-signin-test.example`;
const CLIENT_ID = "langwatch-test-client";
const SUBJECT = `idp-subject-${SUITE}`;
const EMAIL = `member-${SUITE}@${SUITE}.sso-signin-test.example`;
const ORGANIZATION_ID = `sso-signin-org-${SUITE}`;
const createdUserIds: string[] = [];
let assertionAllowed = true;

const MIGRATING_EMAIL = `migrating-${SUITE}@${SUITE}.sso-signin-test.example`;

/** Every decision the app's `resolveUser` asked for, so the test can say the
 *  production wrapper really ran rather than assuming it. */
const decisionsAsked: { providerId: string; email?: string | null }[] = [];

let auth: ReturnType<typeof buildAuth>;
let idToken: string;
let jwks: { keys: unknown[] };
let realFetch: typeof globalThis.fetch;

const base64url = (input: string | Uint8Array): string =>
  Buffer.from(input as Uint8Array).toString("base64url");

/**
 * One signed id token and the public half to verify it with, minted through
 * WebCrypto rather than a library: the token is the identity provider's whole
 * contribution to this flow, and the plugin verifies it against the JWKS the
 * stub serves, so nothing here is trusted on our say-so.
 */
async function mintIdToken(claims: Record<string, unknown>): Promise<{
  token: string;
  jwk: Record<string, unknown>;
}> {
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
  return {
    token: `${header}.${payload}.${base64url(signature)}`,
    jwk: {
      kty: exported.kty,
      n: exported.n,
      e: exported.e,
      alg: "RS256",
      kid: "test",
      use: "sig",
    },
  };
}

/**
 * The application's own better-auth, with its real plugin list: the `sso()`
 * options and the `resolveUser` wrapper under test are production's, and only
 * the decision that wrapper asks for is the suite's.
 */
const buildAuth = () =>
  betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: identityStorageAdapter(),
    trustedOrigins: [IDP, BASE_URL],
    plugins: plugins({
      backupCodeCount: 10,
      // Never reached: nothing here registers a passkey.
      passkeySignUp: () => ({}) as PasskeySignUpRegistration,
      confirmSignUpAddress: async () => undefined,
      ssoAssertion: () => ({
        decide: async ({ providerId, email }) => {
          decisionsAsked.push({ providerId, email });
          return assertionAllowed
            ? { action: "continue" }
            : { action: "reject", error: { code: "sso_domain_not_verified" } };
        },
      }),
      ssoCallbackEvidence: () => ({ recordAuthenticatedSsoAccount: () => {} }),
      ssoProvisionedUsers,
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

beforeAll(async () => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const minted = await mintIdToken({
    iss: IDP,
    aud: CLIENT_ID,
    sub: SUBJECT,
    email: EMAIL,
    email_verified: true,
    name: "Sam Sso",
    iat: issuedAt,
    exp: issuedAt + 300,
  });
  idToken = minted.token;
  jwks = { keys: [minted.jwk] };

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
    if (url.startsWith(`${IDP}/jwks`)) {
      return respond(jwks);
    }
    return realFetch(input, init);
  }) as typeof globalThis.fetch;

  await prisma.ssoProvider.create({
    data: {
      id: `ssoprov_${nanoid(12)}`,
      providerId: PROVIDER_ID,
      issuer: IDP,
      domain: `${SUITE}.sso-signin-test.example`,
      // Written in the plaintext form the cipher still reads, so this row is
      // the derivation's shape without the deployment's secret in it.
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

  await prisma.organization.create({
    data: {
      id: ORGANIZATION_ID,
      name: "SCIM callback test",
      slug: ORGANIZATION_ID,
    },
  });
  const now = new Date();
  await prisma.ssoConnection.create({
    data: {
      id: PROVIDER_ID,
      organizationId: ORGANIZATION_ID,
      type: "oidc",
      state: "ACTIVE",
      claimedDomains: [],
      approvedDomains: [],
      verifiedDomains: [`${SUITE}.sso-signin-test.example`],
      lapsedDomains: [],
      idpMetadata: {},
      source: "self-serve",
      occurredAt: now,
      lastEventId: `event-${SUITE}`,
      acceptedAt: now,
      projectionVersion: "1",
      createdAt: now,
      updatedAt: now,
    },
  });
  auth = buildAuth();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await prisma.ssoProvider.deleteMany({ where: { providerId: PROVIDER_ID } });
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { in: [EMAIL, MIGRATING_EMAIL] } },
        { id: { in: createdUserIds } },
      ],
    },
    select: { id: true },
  });
  for (const user of users) {
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.account.deleteMany({ where: { userId: user.id } });
    await prisma.accountCredential.deleteMany({ where: { userId: user.id } });
    await prisma.passkey.deleteMany({ where: { userId: user.id } });
    await prisma.identifier.deleteMany({ where: { userId: user.id } });
    await prisma.scimDirectoryUser.deleteMany({
      where: { organizationId: ORGANIZATION_ID, userId: user.id },
    });
    await prisma.organizationUser.deleteMany({
      where: { userId: user.id, organizationId: ORGANIZATION_ID },
    });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.ssoConnection.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORGANIZATION_ID } });
  await prisma.verificationToken.deleteMany({
    where: { identifier: { contains: PROVIDER_ID } },
  });
});

async function signInThroughConnection() {
  const started = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: PROVIDER_ID,
        callbackURL: `${BASE_URL}/dashboard`,
      }),
    }),
  );
  const authorize = new URL(
    z.object({ url: z.string() }).parse(await started.json()).url,
  );
  const state = authorize.searchParams.get("state");

  const callback = await auth.handler(
    new Request(
      `${BASE_URL}/api/auth/sso/callback/${PROVIDER_ID}?code=test-code&state=${state}`,
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
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  return { startedStatus: started.status, state, location, cookie, session };
}

describe("given a verified single sign-on connection", () => {
  describe("when somebody signs in through it", () => {
    /** @scenario "A sign-in through a connection completes" */
    it("signs them in, and does not refuse the adapter its transactions", async () => {
      const { startedStatus, state, location, cookie, session } =
        await signInThroughConnection();

      expect(startedStatus).toBe(200);
      expect(state).not.toBeNull();
      expect(location).not.toContain(
        "SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS",
      );
      expect(location).not.toContain("error");
      expect(location).toBe(`${BASE_URL}/dashboard`);
      expect(cookie).not.toBe("");

      // Production's own `resolveUser` ran — the sign-in went through the
      // pre-link check rather than around it.
      expect(decisionsAsked).toEqual([
        { providerId: PROVIDER_ID, email: EMAIL },
      ]);

      expect(session?.user.email).toBe(EMAIL);

      expect(
        await prisma.account.findFirst({
          where: { provider: PROVIDER_ID, providerAccountId: SUBJECT },
          select: { providerAccountId: true },
        }),
      ).not.toBeNull();
    });

    /** @scenario "Moving from the brokered provider to a direct one does not mint a second account" */
    it("links the new direct subject to the verified member who already used the broker", async () => {
      const existing = await prisma.user.create({
        data: {
          email: MIGRATING_EMAIL,
          emailVerified: true,
          name: "Existing member",
        },
      });
      const legacyAccount = await prisma.account.create({
        data: {
          userId: existing.id,
          provider: "auth0",
          providerAccountId: `waad|legacy-${SUITE}`,
          issuer: "https://broker.sso-signin-test.example",
        },
      });
      const directSubject = `direct-${SUITE}`;
      const issuedAt = Math.floor(Date.now() / 1000);
      const minted = await mintIdToken({
        iss: IDP,
        aud: CLIENT_ID,
        sub: directSubject,
        email: MIGRATING_EMAIL,
        email_verified: true,
        name: "Existing member",
        iat: issuedAt,
        exp: issuedAt + 300,
      });
      idToken = minted.token;
      jwks = { keys: [minted.jwk] };

      const { location, session } = await signInThroughConnection();

      expect(location).toBe(`${BASE_URL}/dashboard`);
      expect(session?.user.id).toBe(existing.id);
      expect(session?.user.email).toBe(MIGRATING_EMAIL);
      expect(decisionsAsked).toContainEqual({
        providerId: PROVIDER_ID,
        email: MIGRATING_EMAIL,
      });
      expect(
        await prisma.user.count({ where: { email: MIGRATING_EMAIL } }),
      ).toBe(1);
      expect(
        await prisma.account.findMany({
          where: { userId: existing.id },
          orderBy: { provider: "asc" },
          select: { provider: true, providerAccountId: true, userId: true },
        }),
      ).toEqual([
        {
          provider: legacyAccount.provider,
          providerAccountId: legacyAccount.providerAccountId,
          userId: existing.id,
        },
        {
          provider: PROVIDER_ID,
          providerAccountId: directSubject,
          userId: existing.id,
        },
      ]);
    });
  });
});

async function provisionedUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${SUITE}@${SUITE}.sso-signin-test.example`,
      emailVerified: false,
      name: "Provisioned profile",
    },
  });
  createdUserIds.push(user.id);
  await prisma.identifier.create({
    data: {
      id: `pending-email-${user.id}`,
      userId: user.id,
      provider: "email",
      value: user.email,
      state: "ATTACHED",
      attachedAt: new Date(),
    },
  });
  await prisma.organizationUser.create({
    data: { organizationId: ORGANIZATION_ID, userId: user.id, role: "MEMBER" },
  });
  await prisma.scimDirectoryUser.create({
    data: {
      organizationId: ORGANIZATION_ID,
      connectionId: PROVIDER_ID,
      userId: user.id,
    },
  });
  return { ...user, email: z.string().parse(user.email) };
}

async function assertProviderUser(
  email: string,
  subject: string,
  emailVerified = true,
) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const minted = await mintIdToken({
    iss: IDP,
    aud: CLIENT_ID,
    sub: subject,
    email,
    email_verified: emailVerified,
    name: "Provider profile",
    iat: issuedAt,
    exp: issuedAt + 300,
  });
  idToken = minted.token;
  jwks = { keys: [minted.jwk] };
}

describe("given a member provisioned by the same SSO connection", () => {
  /** @scenario "An inactive directory user cannot sign in through its connection" */
  it.each([
    "first",
    "linked",
    "changed-email",
    "unverified-claim",
    "deleted",
  ])("refuses an inactive tenant resource on %s sign-in without disabling the global user", async (kind) => {
    const user = await provisionedUser(`inactive-${kind}`);
    const subject = `inactive-${kind}-${SUITE}`;
    await assertProviderUser(user.email, subject);
    if (kind !== "first") {
      const initial = await signInThroughConnection();
      expect(initial.session?.user.id).toBe(user.id);
    }
    const sessionsBefore = await prisma.session.count({
      where: { userId: user.id },
    });
    await prisma.scimUserResource.create({
      data: {
        organizationId: ORGANIZATION_ID,
        userId: user.id,
        userName: user.email,
        active: false,
        deletedAt: kind === "deleted" ? new Date() : null,
      },
    });
    await assertProviderUser(
      kind === "changed-email" ? `renamed-${user.email}` : user.email,
      subject,
      kind !== "unverified-claim",
    );

    const result = await signInThroughConnection();

    expect(result.location).toContain("error=");
    expect(result.session).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
      sessionsBefore,
    );
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      email: user.email,
      deactivatedAt: null,
    });
  });

  /** @scenario "A provisioned member signs in without creating another account" */
  it("selects the existing user, preserves their profile, and repeats the exact account binding", async () => {
    const user = await provisionedUser("first-login");
    const subject = `first-login-${SUITE}`;
    await prisma.scimUserResource.create({
      data: {
        organizationId: `other-${ORGANIZATION_ID}`,
        userId: user.id,
        userName: user.email,
        active: false,
      },
    });
    await assertProviderUser(user.email, subject);

    const first = await signInThroughConnection();
    expect(first.location).toBe(`${BASE_URL}/dashboard`);
    expect(first.session?.user.id).toBe(user.id);
    const account = await prisma.account.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(account).toMatchObject({
      provider: PROVIDER_ID,
      providerAccountId: subject,
    });
    expect(
      await prisma.user.findUnique({ where: { id: user.id } }),
    ).toMatchObject({
      email: user.email,
      emailVerified: false,
      name: "Provisioned profile",
    });

    const repeated = await signInThroughConnection();
    expect(repeated.location).toBe(`${BASE_URL}/dashboard`);
    expect(repeated.session?.user.id).toBe(user.id);
    expect(
      await prisma.user.findUnique({ where: { id: user.id } }),
    ).toMatchObject({
      email: user.email,
      emailVerified: false,
      name: "Provisioned profile",
    });
    expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
    expect(
      await prisma.account.findMany({
        where: { userId: user.id },
        select: { id: true },
      }),
    ).toEqual([{ id: account.id }]);
  });

  /** @scenario "SCIM ownership cannot override conflicting sign-in evidence" */
  it.each([
    "unverified-assertion",
    "other-connection",
    "disabled-membership",
    "deactivated-user",
    "missing-membership",
    "account-conflict",
    "subject-account-conflict",
    "identifier-conflict",
    "own-identifier",
    "verified-email",
    "attached-with-verification",
    "attached-with-account",
    "null-email-identifier",
    "credential-without-projection",
    "passkey-without-projection",
    "ambiguous-email",
    "refused-domain",
  ])("refuses %s", async (failure) => {
    const user = await provisionedUser(failure);
    const subject = `${failure}-${SUITE}`;
    if (failure === "other-connection") {
      await prisma.scimDirectoryUser.update({
        where: {
          connectionId_userId: { connectionId: PROVIDER_ID, userId: user.id },
        },
        data: { connectionId: `other-${PROVIDER_ID}` },
      });
    }
    if (failure === "disabled-membership") {
      await prisma.organizationUser.update({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: ORGANIZATION_ID,
          },
        },
        data: { disabledAt: new Date() },
      });
    }
    if (failure === "missing-membership") {
      await prisma.organizationUser.deleteMany({
        where: { userId: user.id, organizationId: ORGANIZATION_ID },
      });
    }
    if (failure === "deactivated-user") {
      await prisma.user.update({
        where: { id: user.id },
        data: { deactivatedAt: new Date() },
      });
    }
    if (
      failure === "verified-email" ||
      failure === "attached-with-verification"
    ) {
      await prisma.identifier.update({
        where: { id: `pending-email-${user.id}` },
        data: {
          state: failure === "verified-email" ? "VERIFIED" : "ATTACHED",
          verifiedAt: new Date(),
        },
      });
    }
    if (failure === "attached-with-account") {
      await prisma.identifier.update({
        where: { id: `pending-email-${user.id}` },
        data: { accountId: `credential-${user.id}`, providerId: "credential" },
      });
    }
    if (failure === "null-email-identifier") {
      await prisma.identifier.update({
        where: { id: `pending-email-${user.id}` },
        data: { value: null },
      });
    }
    if (failure === "credential-without-projection") {
      await prisma.accountCredential.create({
        data: {
          id: `credential-${user.id}`,
          userId: user.id,
          provider: "credential",
          password: "existing-proof",
        },
      });
    }
    if (failure === "passkey-without-projection") {
      await prisma.passkey.create({
        data: {
          userId: user.id,
          publicKey: "existing-public-key",
          credentialID: `passkey-${user.id}`,
          deviceType: "singleDevice",
        },
      });
    }
    if (failure === "ambiguous-email") {
      const duplicate = await prisma.user.create({
        data: { email: user.email.toUpperCase() },
      });
      createdUserIds.push(duplicate.id);
    }
    if (failure === "account-conflict") {
      await prisma.account.create({
        data: {
          userId: user.id,
          provider: "credential",
          providerAccountId: user.id,
          issuer: "credential",
          password: "existing-credential-proof",
        },
      });
    }
    if (failure === "subject-account-conflict") {
      const other = await provisionedUser("subject-owner");
      await prisma.account.create({
        data: {
          userId: other.id,
          provider: PROVIDER_ID,
          providerAccountId: subject,
          issuer: IDP,
        },
      });
    }
    if (failure === "identifier-conflict" || failure === "own-identifier") {
      const owner =
        failure === "own-identifier"
          ? user
          : await provisionedUser("identifier-owner");
      await prisma.identifier.create({
        data: {
          id: `${failure}-${SUITE}`,
          userId: owner.id,
          provider: "oidc",
          state: "VERIFIED",
          value: user.email,
          issuer: IDP,
          providerId: PROVIDER_ID,
          providerAccountId: subject,
          attachedAt: new Date(),
        },
      });
    }
    await assertProviderUser(
      user.email,
      subject,
      failure !== "unverified-assertion",
    );
    assertionAllowed = failure !== "refused-domain";
    try {
      const result = await signInThroughConnection();
      expect(result.session).toBeNull();
      const error = new URL(result.location, BASE_URL).searchParams.get(
        "error",
      );
      expect(normalizeErrorCode(error)).toBe(
        failure === "refused-domain"
          ? "sso_domain_not_verified"
          : "OAuthAccountNotLinked",
      );
      expect(
        await prisma.account.count({
          where: { userId: user.id, provider: PROVIDER_ID },
        }),
      ).toBe(0);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
        0,
      );
      expect(
        await prisma.user.findUnique({ where: { id: user.id } }),
      ).toMatchObject({
        emailVerified: false,
      });
    } finally {
      assertionAllowed = true;
    }
  });

  /** @scenario "A signed SAML email does not require an OIDC verification claim" */
  it("resolves the provisioned member from the accepted signed SAML profile", async () => {
    const user = await provisionedUser("saml-profile");
    const result = await postgresTransactionOver(prisma)(async () =>
      ssoProvisionedUsers().resolve({
        protocol: "saml",
        providerId: PROVIDER_ID,
        accountKey: { issuer: IDP, accountId: `saml-${SUITE}` },
        providerUser: {
          email: user.email,
          emailVerified: false,
          name: "Signed profile",
        },
        providerAttributes: { email: user.email },
        providerReference: {
          providerId: PROVIDER_ID,
          source: { type: "persisted", recordId: PROVIDER_ID },
          authenticationConfigurationFingerprint:
            "accepted-signed-configuration",
        },
      }),
    );
    expect(result).toEqual({
      action: "link",
      userId: user.id,
      profile: "preserve",
    });
  });

  /** @scenario "Provisioned sign-in evidence stays inside the native transaction" */
  it("reads uncommitted membership in the callback transaction and clears that context afterwards", async () => {
    const user = await provisionedUser("transaction-scope");
    const input = {
      protocol: "oidc" as const,
      providerId: PROVIDER_ID,
      accountKey: { issuer: IDP, accountId: `transaction-${SUITE}` },
      providerUser: {
        email: user.email,
        emailVerified: true,
        name: "Verified profile",
      },
      providerClaims: {},
      verifiedIdTokenClaims: {},
      providerReference: {
        providerId: PROVIDER_ID,
        source: { type: "persisted" as const, recordId: PROVIDER_ID },
        authenticationConfigurationFingerprint: "accepted-configuration",
      },
    };
    await postgresTransactionOver(prisma)(async () => {
      const transaction = identityStorageTransactions.getStore();
      if (!transaction) throw new Error("The native transaction was not bound");
      await transaction.organizationUser.update({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: ORGANIZATION_ID,
          },
        },
        data: { disabledAt: new Date() },
      });
      expect(await ssoProvisionedUsers().resolve(input)).toEqual({
        action: "reject",
        code: "OAuthAccountNotLinked",
      });
      expect(
        await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: user.id,
              organizationId: ORGANIZATION_ID,
            },
          },
        }),
      ).toMatchObject({ disabledAt: null });
    });
    expect(identityStorageTransactions.getStore()).toBeUndefined();
    await expect(ssoProvisionedUsers().resolve(input)).rejects.toThrow(
      "SCIM sign-in resolution requires the native identity transaction",
    );
  });
});
