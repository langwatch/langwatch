import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";
import * as samlify from "samlify";
import { generate } from "selfsigned";
import { z } from "zod";

import { createSessionGateHooks } from "~/server/better-auth/__tests__/support/session-gate";
import { databaseHooks as configureDatabaseHooks } from "~/server/better-auth/config/database-hooks";
import { models } from "~/server/better-auth/config/models";
import { plugins } from "~/server/better-auth/config/plugins";
import { CredentialSessionGuard } from "~/server/better-auth/credential-session-guard";
import type { BetterAuthDatabaseHooks } from "~/server/better-auth/hooks";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import {
  identityStorageAdapter,
  sessionCallbackEvidence,
  sessionClaims,
  ssoAssertion,
  ssoProvisionedUsers,
} from "../runtime";

const BASE_URL = "http://localhost:3000";
const POST = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";
const REDIRECT = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const SP_ENTITY = `${BASE_URL}/api/auth/sso/saml2/sp`;

function samlSessionHooks(productionHooks?: BetterAuthDatabaseHooks) {
  const hooks = createSessionGateHooks({
    findUser: (id) =>
      prisma.user.findUnique({
        where: { id },
        select: { deactivatedAt: true, signupConfirmationPending: true },
      }),
  });
  const guard = new CredentialSessionGuard({ canSignIn: async () => true });
  const configured = configureDatabaseHooks({
    hooks: () => productionHooks ?? hooks,
    credentialSessions: () => guard,
    sessionClaims,
    providerAssertions: sessionCallbackEvidence,
    userErasure: () => ({ beforeUserDelete: async () => {} }),
    accountCeremonies: () => ({
      beforeAccountCreate: async () => void 0,
      beforeAccountDelete: async () => {},
    }),
  });
  return productionHooks ? configured : { session: configured?.session };
}

export async function createSigningIdentity() {
  const pem = await generate([{ name: "commonName", value: "saml.test" }], {
    keySize: 2048,
    notAfterDate: new Date(Date.now() + 86_400_000),
  });
  return samlify.IdentityProvider({
    entityID: "https://idp.saml.test",
    privateKey: pem.private,
    signingCert: pem.cert,
    wantAuthnRequestsSigned: false,
    singleSignOnService: [
      { Binding: REDIRECT, Location: "https://idp.saml.test/sso" },
    ],
  });
}

export async function createSamlFixture(
  idp: Awaited<ReturnType<typeof createSigningIdentity>>,
  options: {
    databaseHooks?: BetterAuthDatabaseHooks;
    arrivalPolicy?: "admit" | "request" | "refuse";
  } = {},
) {
  const suffix = nanoid(10).toLowerCase();
  const providerId = `ssoc_saml_${suffix}`;
  const organizationId = `org_saml_${suffix}`;
  const domain = `${suffix}.saml.test`;
  const acs = `${BASE_URL}/api/auth/sso/saml2/sp/acs/${providerId}`;
  const now = new Date();
  await prisma.organization.create({
    data: { id: organizationId, name: "SAML test", slug: organizationId },
  });
  await prisma.ssoConnection.create({
    data: {
      id: providerId,
      organizationId,
      type: "saml",
      state: "ACTIVE",
      claimedDomains: [domain],
      approvedDomains: [domain],
      verifiedDomains: [domain],
      domainVerifications: [
        {
          domain,
          method: "dns-txt",
          actorId: null,
          verifiedAtMs: now.getTime(),
          proofState: "VERIFIED",
          firstAbsentAtMs: null,
          graceEndsAtMs: null,
          tokenHash: "sha256:test",
          evidenceRef: "sha256:test",
          note: null,
          verifier: { type: "system", id: "test" },
        },
      ],
      lapsedDomains: [],
      idpMetadata: {},
      ...(options.arrivalPolicy
        ? {
            arrivalPolicy: options.arrivalPolicy,
            arrivalPolicyDecidedAt: now,
          }
        : {}),
      source: "self-serve",
      occurredAt: now,
      lastEventId: `event-${suffix}`,
      acceptedAt: now,
      projectionVersion: "1",
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.ssoProvider.create({
    data: {
      id: providerId,
      providerId,
      issuer: providerId,
      organizationId,
      domain,
      samlConfig: JSON.stringify({
        entryPoint: "https://idp.saml.test/sso",
        idpMetadata: { metadata: idp.getMetadata() },
        spMetadata: { entityID: SP_ENTITY },
        wantAssertionsSigned: true,
        mapping: { id: "nameID", email: "email" },
      }),
    },
  });
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: identityStorageAdapter(),
    trustedOrigins: [BASE_URL, "https://idp.saml.test"],
    databaseHooks: samlSessionHooks(options.databaseHooks),
    plugins: plugins({
      backupCodeCount: 10,
      passkeySignUp: () => {
        throw new Error("Passkey registration is outside this fixture");
      },
      confirmSignUpAddress: async () => void 0,
      ssoAssertion,
      ssoProvisionedUsers,
      ssoCallbackEvidence: sessionCallbackEvidence,
    }),
    ...models(),
  });
  const sp = samlify.ServiceProvider({
    entityID: SP_ENTITY,
    wantAssertionsSigned: true,
    assertionConsumerService: [{ Binding: POST, Location: acs }],
  });
  const userIds: string[] = [];

  async function createLocalUser(
    emailVerified = true,
    email = `member@${domain}`,
  ) {
    const user = await prisma.user.create({
      data: {
        email,
        emailVerified,
        name: "Preserved local name",
        image: "https://local.test/avatar",
      },
    });
    userIds.push(user.id);
    const account = await prisma.account.create({
      data: {
        userId: user.id,
        provider: "credential",
        providerAccountId: user.id,
        password: "existing-password-hash",
      },
    });
    const identifier = await prisma.identifier.create({
      data: {
        id: `idf_${nanoid()}`,
        userId: user.id,
        provider: "credential",
        value: email,
        accountId: account.id,
        providerId: "credential",
        providerAccountId: user.id,
        state: emailVerified ? "VERIFIED" : "ATTACHED",
        attachedAt: now,
        verifiedAt: emailVerified ? now : null,
      },
    });
    return { email, user, account, identifier };
  }

  async function signIn(email: string, tamper = false) {
    const started = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId,
          callbackURL: `${BASE_URL}/dashboard`,
        }),
      }),
    );
    const url = new URL(
      z.object({ url: z.string() }).parse(await started.json()).url,
    );
    const request = await idp.parseLoginRequest(sp, "redirect", {
      query: Object.fromEntries(url.searchParams),
    });
    const signed = await idp.createLoginResponse(
      sp,
      { extract: request.extract },
      "post",
      {
        email,
      },
    );
    const samlResponse = tamper
      ? Buffer.from(
          Buffer.from(signed.context, "base64")
            .toString()
            .replace(email, `other@${domain}`),
        ).toString("base64")
      : signed.context;
    const callback = await sessionCallbackEvidence().runWithScope(() =>
      auth.handler(
        new Request(acs, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie: started.headers
              .getSetCookie()
              .map((value) => value.split(";")[0])
              .join("; "),
          },
          body: new URLSearchParams({
            SAMLResponse: samlResponse,
            RelayState: url.searchParams.get("RelayState") ?? "",
          }),
        }),
      ),
    );
    const cookie = callback.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const readSession = () =>
      auth.api.getSession({ headers: new Headers({ cookie }) });
    const session = await readSession();
    if (session?.user.id && !userIds.includes(session.user.id)) {
      userIds.push(session.user.id);
    }
    return { location: callback.headers.get("location"), session, readSession };
  }

  async function cleanup() {
    await Promise.all(
      userIds.map((userId) =>
        prisma.systemMigrationTenantState.deleteMany({
          where: {
            tenantId: userId,
            migrationName: "identity-d01-identifier-backfill",
          },
        }),
      ),
    );
    await prisma.identityProjectionCursor.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.identifierReservation.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.identifier.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    // Grants and their audit rows are projection facts without relations to
    // the fixture's organization or users. Remove them explicitly before the
    // organization goes away so this fixture cannot leak access decisions or
    // governance history into the next integration file.
    await cleanupTestRows(prisma, [
      ["grantUsage", { organizationId }],
      ["grant", { organizationId }],
      ["roleBinding", { organizationId }],
      ["role", { organizationId }],
      ["auditLog", { organizationId }],
    ]);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.ssoProvider.deleteMany({ where: { providerId } });
    await prisma.ssoConnection.deleteMany({ where: { id: providerId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  return {
    providerId,
    organizationId,
    domain,
    createLocalUser,
    signIn,
    cleanup,
  };
}
