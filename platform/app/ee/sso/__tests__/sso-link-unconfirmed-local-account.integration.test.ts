/**
 * @vitest-environment node
 *
 * Single sign-on onto a password account whose address was never confirmed
 * (specs/identity/sso-link-unconfirmed-local-account.feature).
 *
 * What is real here: Postgres, the composed identity storage adapter, the
 * app's own plugin list and database hooks, the production assertion gate
 * (`ssoAssertion()`) and
 * the production user resolver (`ssoProvisionedUsers()`), and the plugin's
 * whole OIDC and SAML callbacks. Only the identity provider stands in: a
 * stubbed `fetch` answering discovery, token and JWKS with a signed id token
 * for OIDC, and a samlify identity provider signing the SAML response.
 */

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

import { PrismaScimSsoUsers } from "@ee/scim/scim-sso-user.prisma.repository";
import type { SsoIssuerDiscoveryPort } from "@ee/sso/sso-idp-registration";
import { SsoIssuerEndpointOrigins } from "@ee/sso/sso-issuer-endpoint-origins";
import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";
import * as samlify from "samlify";
import { generate } from "selfsigned";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { normalizeErrorCode } from "~/features/auth/logic/signInErrorCodes";
import { identityStorageTransactions } from "~/server/app-layer/identity/identity-storage-transaction.adapter";
import {
  databaseHooks as composeDatabaseHooks,
  credentialSessions,
  identityBridgeCeremonies,
  identityCeremonies,
  identityStorageAdapter,
  sessionCallbackEvidence,
  sessionClaims,
  ssoAssertion,
  ssoProvisionedUsers,
  ssoRegisteredIssuers,
} from "~/server/app-layer/identity/runtime";
import { handleAuthRequest } from "~/server/better-auth/auth-request";
import { databaseHooks } from "~/server/better-auth/config/database-hooks";
import { models } from "~/server/better-auth/config/models";
import { plugins } from "~/server/better-auth/config/plugins";
import { noteIdTokenIssuerRefusal } from "~/server/better-auth/id-token-issuer-mismatch";
import type { PasskeySignUpRegistration } from "~/server/better-auth/passkey-signup";
import { resolveTrustedOrigins } from "~/server/better-auth/trustedOrigins";
import { prisma } from "~/server/db";

const BASE_URL = "http://localhost:3000";
const SUITE = nanoid(8).toLowerCase();
const DOMAIN = `${SUITE}.unconfirmed-link-test.example`;
const IDP = `https://idp-${SUITE}.unconfirmed-link-test.example`;
/** Microsoft Entra ID tenant issuers, the shape `xms_edov` is read for. One
 *  tenant per connection, since an issuer routes to a single connection. */
const ENTRA_HOST = "https://login.microsoftonline.com";
const entra = (label: string) => `${ENTRA_HOST}/${SUITE}-${label}/v2.0`;
/** Google's issuer. Its discovery document serves token, userinfo and keys
 *  from `*.googleapis.com`, other origins than the issuer's. */
const GOOGLE = "https://accounts.google.com";
const googleDiscovery = () => ({
  issuer: GOOGLE,
  authorization_endpoint: `${GOOGLE}/o/oauth2/v2/auth`,
  token_endpoint: "https://oauth2.googleapis.com/token",
  userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid", "email", "profile"],
});
/** Issuers stored with only a discovery endpoint, the way production stores
 *  every connection, so the engine reads the endpoints at sign-in. */
const discoveredOnly = (issuer: string) =>
  issuer.startsWith(`${ENTRA_HOST}/`) || issuer === GOOGLE;
const CLIENT_ID = "langwatch-test-client";
const SAML_IDP = `https://saml-${SUITE}.unconfirmed-link-test.example`;
const SP_ENTITY_ID = `${BASE_URL}/api/auth/sso/saml2/sp`;
const POST_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";
const REDIRECT_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const organizationIds: string[] = [];
const connectionIds: string[] = [];
const userIds: string[] = [];

let idToken = "";
/** What Microsoft Graph's userinfo endpoint answers for the signed-in user:
 *  the profile, with no verification claim. */
let graphUserInfo: Record<string, unknown> = {};
const GRAPH_USERINFO = "https://graph.microsoft.com/oidc/userinfo";
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

/**
 * The ID token the provider signs. `emailVerified` left out sends no
 * `email_verified` claim at all, the way Microsoft Entra ID signs its tokens;
 * `claims` adds the rest (`xms_edov`).
 */
async function identityProviderAsserts({
  email,
  subject,
  emailVerified,
  issuer = IDP,
  claims = {},
}: {
  email: string;
  subject: string;
  emailVerified?: boolean;
  issuer?: string;
  claims?: Record<string, unknown>;
}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  graphUserInfo = { sub: subject, email, name: "Provider profile" };
  await mintIdToken({
    iss: issuer,
    aud: CLIENT_ID,
    sub: subject,
    email,
    ...(emailVerified === undefined ? {} : { email_verified: emailVerified }),
    ...claims,
    name: "Provider profile",
    iat: issuedAt,
    exp: issuedAt + 300,
  });
}

/** The production endpoint-origin lookup, reading discovery through the
 *  stubbed fetch, with every host resolving public. */
const discoveryThroughFetch: SsoIssuerDiscoveryPort = {
  async discover({ issuer }) {
    const document = await globalThis
      .fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`)
      .then((response) => response.json() as Promise<Record<string, unknown>>)
      .catch(() => null);
    if (document === null) return { reachable: false, reason: "unreachable" };
    return {
      reachable: true,
      endpoints: Object.entries(document)
        .filter(([key]) => key.endsWith("_endpoint") || key === "jwks_uri")
        .map(([, value]) => String(value)),
    };
  },
};
const issuerEndpointOrigins = new SsoIssuerEndpointOrigins({
  discovery: discoveryThroughFetch,
  resolveHost: async () => ["93.184.216.34"],
});

/** The resolver as LangWatch Cloud composes it. */
const cloudUsers = PrismaScimSsoUsers.create(identityStorageTransactions, {
  isHosted: () => true,
});

/**
 * better-auth with the production plugins, models and database hooks, wired
 * from the same runtime collaborators `server/better-auth/index.ts` uses. The
 * hooks matter: the account-create hook re-checks the link's evidence, and a
 * harness without them passed while production refused every link.
 */
const auth = ({ cloud = false }: { cloud?: boolean } = {}) =>
  betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: identityStorageAdapter(),
    // The production logger hook: an ID token refused for its issuer is
    // noted here, so the callback can name the mismatch.
    logger: {
      disabled: false,
      log: (_level, message, ...args) =>
        noteIdTokenIssuerRefusal([message, ...args]),
    },
    // The production resolution: the origins of the issuer the request names,
    // and for Entra ID the Microsoft Graph origin its userinfo endpoint is on.
    trustedOrigins: async (request) => {
      const registeredIssuers =
        await ssoRegisteredIssuers().issuersForRequest(request);
      return resolveTrustedOrigins({
        nextAuthUrl: BASE_URL,
        baseHost: undefined,
        trustedIdpOrigins: undefined,
        idpSimulatorUrl: undefined,
        registeredIssuers,
        issuerEndpointOrigins:
          await issuerEndpointOrigins.originsFor(registeredIssuers),
        isProduction: false,
      });
    },
    plugins: plugins({
      backupCodeCount: 10,
      passkeySignUp: () => ({}) as PasskeySignUpRegistration,
      confirmSignUpAddress: async () => undefined,
      ssoAssertion,
      ssoCallbackEvidence: sessionCallbackEvidence,
      ssoProvisionedUsers: cloud ? () => cloudUsers : ssoProvisionedUsers,
    }),
    databaseHooks: databaseHooks({
      hooks: composeDatabaseHooks,
      userErasure: identityCeremonies,
      accountCeremonies: identityBridgeCeremonies,
      sessionClaims,
      providerAssertions: sessionCallbackEvidence,
      credentialSessions,
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
  confirmed = false,
}: {
  label: string;
  organizationId: string;
  confirmed?: boolean;
}) {
  const email = `${label}-${SUITE}@${DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Password profile",
      emailVerified: confirmed,
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
  issuer = IDP,
  protocol = "oidc",
}: {
  organizationId: string;
  state: "ACTIVE" | "DRAFT";
  domainVerified: boolean;
  createdBy: string;
  issuer?: string;
  protocol?: "oidc" | "saml";
}): Promise<string> {
  const id = `local_ssoc_${nanoid(16)}`;
  connectionIds.push(id);
  const now = new Date();
  await prisma.ssoConnection.create({
    data: {
      id,
      organizationId,
      type: protocol,
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
  if (protocol === "saml") {
    // The configuration `sso-engine-provider.ts` projects for a SAML
    // connection: no verification attribute is mapped.
    await prisma.ssoProvider.create({
      data: {
        id: `ssoprov_${nanoid(12)}`,
        providerId: id,
        issuer: SAML_IDP,
        domain: DOMAIN,
        samlConfig: JSON.stringify({
          entryPoint: `${SAML_IDP}/sso`,
          idpMetadata: { metadata: samlIdentity.metadata },
          spMetadata: { entityID: SP_ENTITY_ID },
          wantAssertionsSigned: true,
          mapping: { id: "nameID", email: "email" },
        }),
      },
    });
    return id;
  }
  await prisma.ssoProvider.create({
    data: {
      id: `ssoprov_${nanoid(12)}`,
      providerId: id,
      issuer,
      domain: DOMAIN,
      // An Entra ID connection is stored the way `sso-engine-provider.ts`
      // stores every connection, with only the discovery endpoint, so the
      // engine reads the rest, userinfo included, from discovery at sign-in.
      oidcConfig: JSON.stringify({
        clientId: CLIENT_ID,
        clientSecret: "langwatch-test-secret",
        discoveryEndpoint: `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
        ...(discoveredOnly(issuer)
          ? {}
          : {
              authorizationEndpoint: `${issuer}/authorize`,
              tokenEndpoint: `${issuer}/token`,
              jwksEndpoint: `${issuer}/jwks`,
            }),
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
  issuer,
  protocol,
  confirmed,
}: {
  label: string;
  state: "ACTIVE" | "DRAFT";
  domainVerified: boolean;
  issuer?: string;
  protocol?: "oidc" | "saml";
  confirmed?: boolean;
}) {
  const organizationId = `unconfirmed-link-${label}-${SUITE}`;
  organizationIds.push(organizationId);
  await prisma.organization.create({
    data: { id: organizationId, name: label, slug: organizationId },
  });
  const user = await unconfirmedPasswordAccount({
    label,
    organizationId,
    confirmed,
  });
  const providerId = await connection({
    organizationId,
    state,
    domainVerified,
    createdBy: user.id,
    issuer,
    protocol,
  });
  return { user, providerId };
}

/** The SAML identity provider: a signing key and the metadata naming it. */
let samlIdentity: {
  idp: ReturnType<typeof samlify.IdentityProvider>;
  metadata: string;
};

async function samlIdentityProvider() {
  const pem = await generate([{ name: "commonName", value: "saml.test" }], {
    notAfterDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    keySize: 2048,
  });
  const idp = samlify.IdentityProvider({
    entityID: SAML_IDP,
    privateKey: pem.private,
    signingCert: pem.cert,
    wantAuthnRequestsSigned: false,
    singleSignOnService: [
      { Binding: POST_BINDING, Location: `${SAML_IDP}/sso` },
      { Binding: REDIRECT_BINDING, Location: `${SAML_IDP}/sso` },
    ],
  });
  const body = pem.cert.replace(/-----[^-]+-----|\s/g, "");
  const metadata = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${SAML_IDP}"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${body}</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="${REDIRECT_BINDING}" Location="${SAML_IDP}/sso"/><SingleSignOnService Binding="${POST_BINDING}" Location="${SAML_IDP}/sso"/></IDPSSODescriptor></EntityDescriptor>`;
  return { idp, metadata };
}

/**
 * A service-provider-initiated SAML sign-in, the only kind production
 * accepts: start it, answer the request the plugin issued with a signed
 * response for `email`, and post that to the assertion consumer service.
 */
async function signInThroughSaml(providerId: string, email: string) {
  const betterAuthInstance = auth();
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
  const samlRequest = authorize.searchParams.get("SAMLRequest") ?? "";
  const requestXml = inflateRawSync(
    Buffer.from(samlRequest, "base64"),
  ).toString("utf8");
  const requestId = /\sID="([^"]+)"/.exec(requestXml)?.[1] ?? "";
  const acs = `${BASE_URL}/api/auth/sso/saml2/sp/acs/${providerId}`;
  const sp = samlify.ServiceProvider({
    entityID: SP_ENTITY_ID,
    wantAssertionsSigned: true,
    assertionConsumerService: [{ Binding: POST_BINDING, Location: acs }],
  });
  const response = await samlIdentity.idp.createLoginResponse(
    sp,
    { extract: { request: { id: requestId } } },
    "post",
    { email },
  );
  const callback = await betterAuthInstance.handler(
    new Request(acs, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: started.headers.get("set-cookie") ?? "",
      },
      body: new URLSearchParams({
        SAMLResponse: response.context,
        RelayState: authorize.searchParams.get("RelayState") ?? "",
      }),
    }),
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
  const callbackRequest = new Request(
    `${BASE_URL}/api/auth/sso/callback/${providerId}?code=test-code&state=${state}`,
    {
      method: "GET",
      redirect: "manual",
      headers: { cookie: started.headers.get("set-cookie") ?? "" },
    },
  );
  // Through the same request handling the auth route uses.
  const callback = await handleAuthRequest({
    request: callbackRequest,
    handler: (request) => betterAuthInstance.handler(request),
  });
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

/**
 * An Entra ID tenant's discovery document, as Microsoft serves it: sign-in
 * endpoints under the tenant on `login.microsoftonline.com`, userinfo on
 * Microsoft Graph.
 */
function entraDiscovery(issuer: string) {
  const tenant = issuer.replace(/\/v2\.0$/, "");
  return {
    issuer,
    authorization_endpoint: `${tenant}/oauth2/v2.0/authorize`,
    token_endpoint: `${tenant}/oauth2/v2.0/token`,
    jwks_uri: `${tenant}/discovery/v2.0/keys`,
    userinfo_endpoint: GRAPH_USERINFO,
    end_session_endpoint: `${tenant}/oauth2/v2.0/logout`,
    response_types_supported: ["code", "id_token", "code id_token"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "private_key_jwt",
      "client_secret_basic",
    ],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "auth_time",
      "nonce",
      "preferred_username",
      "name",
      "tid",
      "ver",
      "email",
    ],
    tenant_region_scope: "EU",
    cloud_instance_name: "microsoftonline.com",
  };
}

const tokenResponse = () => ({
  access_token: `access-${SUITE}`,
  id_token: idToken,
  token_type: "Bearer",
  expires_in: 3600,
});

beforeAll(async () => {
  samlIdentity = await samlIdentityProvider();
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith(GRAPH_USERINFO)) return respond(graphUserInfo);
    if (url.startsWith(`${ENTRA_HOST}/`)) {
      if (url.includes("/.well-known/openid-configuration")) {
        return respond(
          entraDiscovery(
            (url.split("/.well-known/")[0] ?? "").replace(/\/+$/, ""),
          ),
        );
      }
      if (url.includes("/oauth2/v2.0/token")) return respond(tokenResponse());
      if (url.includes("/discovery/v2.0/keys")) return respond(jwks);
    }
    if (url === `${GOOGLE}/.well-known/openid-configuration`) {
      return respond(googleDiscovery());
    }
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return respond(tokenResponse());
    }
    if (url.startsWith("https://www.googleapis.com/oauth2/v3/certs")) {
      return respond(jwks);
    }
    if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) {
      return respond(graphUserInfo);
    }
    const issuer = url.startsWith(IDP) ? IDP : undefined;
    if (!issuer) return realFetch(input, init);
    if (url.startsWith(`${issuer}/.well-known/openid-configuration`)) {
      return respond({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    }
    if (url.startsWith(`${issuer}/token`)) return respond(tokenResponse());
    if (url.startsWith(`${issuer}/jwks`)) return respond(jwks);
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

  describe("when the identity provider asserts the address is not verified", () => {
    /** @scenario "An identity provider that says the address is not verified does not link an unconfirmed account" */
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

  describe("when the account is deactivated or another account holds its identity", () => {
    /** @scenario "A deactivated or contested unconfirmed account is not linked" */
    it.each([
      "deactivated",
      "address-held-elsewhere",
      "subject-held-elsewhere",
    ])("refuses the %s account and leaves it as it was", async (kind) => {
      const { user, providerId } = await setUp({
        label: kind,
        state: "ACTIVE",
        domainVerified: true,
      });
      const subject = `${kind}-${SUITE}`;
      if (kind === "deactivated") {
        await prisma.user.update({
          where: { id: user.id },
          data: { deactivatedAt: new Date() },
        });
      } else {
        const other = await prisma.user.create({
          data: { email: `other-${kind}-${SUITE}@${DOMAIN}`, name: "Other" },
        });
        userIds.push(other.id);
        await prisma.identifier.create({
          data: {
            id: `${kind}-identifier-${SUITE}`,
            userId: other.id,
            provider: "oidc",
            state: "VERIFIED",
            value:
              kind === "address-held-elsewhere"
                ? user.email
                : `unrelated-${SUITE}@${DOMAIN}`,
            issuer: kind === "subject-held-elsewhere" ? IDP : null,
            providerId: kind === "subject-held-elsewhere" ? providerId : null,
            providerAccountId:
              kind === "subject-held-elsewhere" ? subject : null,
            attachedAt: new Date(),
          },
        });
      }
      await identityProviderAsserts({
        email: user.email,
        subject,
        emailVerified: true,
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBe("OAuthAccountNotLinked");
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

  describe("when Microsoft Entra ID signs it in without an email_verified claim", () => {
    /** @scenario "Microsoft Entra ID links an unconfirmed password account without sending email_verified" */
    it("links the existing account, confirms the address and reuses the binding", async () => {
      const { user, providerId } = await setUp({
        label: "entra-silent",
        state: "ACTIVE",
        domainVerified: true,
        issuer: entra("entra-silent"),
      });
      const subject = `entra-silent-${SUITE}`;
      await identityProviderAsserts({
        email: user.email,
        subject,
        issuer: entra("entra-silent"),
        claims: { tid: `${SUITE}-tenant`, oid: subject },
      });

      const first = await signInThrough(providerId);

      expect(first.error).toBeNull();
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

  describe("when Microsoft Entra ID sends xms_edov true", () => {
    /** @scenario "Microsoft Entra ID's xms_edov true links an unconfirmed password account" */
    it("links the existing account and confirms the address", async () => {
      const { user, providerId } = await setUp({
        label: "entra-edov",
        state: "DRAFT",
        domainVerified: true,
        issuer: entra("entra-edov"),
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `entra-edov-${SUITE}`,
        issuer: entra("entra-edov"),
        claims: { xms_edov: true },
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBeNull();
      expect(result.session?.user.id).toBe(user.id);
      expect(await addressConfirmed(user.id)).toBe(true);
      expect(await linkedAccounts(user.id, providerId)).toHaveLength(1);
    });
  });

  describe("when Microsoft Entra ID sends xms_edov false", () => {
    /** @scenario "Microsoft Entra ID's xms_edov false does not link an unconfirmed account" */
    it("refuses with the named code and leaves the account as it was", async () => {
      const { user, providerId } = await setUp({
        label: "entra-edov-false",
        state: "ACTIVE",
        domainVerified: true,
        issuer: entra("entra-edov-false"),
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `entra-edov-false-${SUITE}`,
        issuer: entra("entra-edov-false"),
        claims: { xms_edov: false },
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBe("sso_existing_account_unconfirmed");
      expect(result.session).toBeNull();
      expect(await linkedAccounts(user.id, providerId)).toEqual([]);
      expect(await addressConfirmed(user.id)).toBe(false);
    });
  });

  describe("when a provider that sends no email_verified signs in before the domain is verified", () => {
    /** @scenario "An unconfirmed account on a domain the connection has not verified is not linked" */
    it("refuses with the named code and leaves the account as it was", async () => {
      const { user, providerId } = await setUp({
        label: "entra-unproved",
        state: "DRAFT",
        domainVerified: false,
        issuer: entra("entra-unproved"),
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `entra-unproved-${SUITE}`,
        issuer: entra("entra-unproved"),
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBe("sso_existing_account_unconfirmed");
      expect(result.session).toBeNull();
      expect(await linkedAccounts(user.id, providerId)).toEqual([]);
      expect(await addressConfirmed(user.id)).toBe(false);
    });
  });

  describe("when a SAML connection that verified the domain signs it in", () => {
    /** @scenario "A SAML connection links an unconfirmed password account on a verified domain" */
    it("links the existing account and confirms the address", async () => {
      const { user, providerId } = await setUp({
        label: "saml",
        state: "ACTIVE",
        domainVerified: true,
        protocol: "saml",
      });

      const result = await signInThroughSaml(providerId, user.email);

      expect(result.error).toBeNull();
      expect(result.session?.user.id).toBe(user.id);
      expect(await addressConfirmed(user.id)).toBe(true);
      expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
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

describe("given a password account whose address is confirmed", () => {
  describe("when Microsoft Entra ID signs it in without an email_verified claim", () => {
    /** @scenario "A confirmed password account links when the provider sends no email_verified" */
    it("links the existing account instead of refusing it", async () => {
      const { user, providerId } = await setUp({
        label: "entra-confirmed",
        state: "ACTIVE",
        domainVerified: true,
        issuer: entra("entra-confirmed"),
        confirmed: true,
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `entra-confirmed-${SUITE}`,
        issuer: entra("entra-confirmed"),
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBeNull();
      expect(result.session?.user.id).toBe(user.id);
      expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
      expect(await linkedAccounts(user.id, providerId)).toHaveLength(1);
    });
  });

  describe("when a provider that sends no email_verified signs it in before the domain is verified", () => {
    /** @scenario "A confirmed account on a domain the connection has not verified is refused with the missing proof named" */
    it("refuses with sso_domain_not_verified and leaves the account as it was", async () => {
      const { user, providerId } = await setUp({
        label: "entra-confirmed-unproved",
        state: "DRAFT",
        domainVerified: false,
        issuer: entra("entra-confirmed-unproved"),
        confirmed: true,
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `entra-confirmed-unproved-${SUITE}`,
        issuer: entra("entra-confirmed-unproved"),
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBe("sso_domain_not_verified");
      expect(result.session).toBeNull();
      expect(await linkedAccounts(user.id, providerId)).toEqual([]);
      expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
    });
  });
});

describe("given a password account whose address was never confirmed, on LangWatch Cloud", () => {
  describe("when Microsoft Entra ID signs it in without an email_verified claim", () => {
    /** @scenario "On LangWatch Cloud a provider that sends no email_verified does not link an existing account" */
    it("keeps better-auth's own refusal and leaves the account as it was", async () => {
      const { user, providerId } = await setUp({
        label: "cloud-entra",
        state: "ACTIVE",
        domainVerified: true,
        issuer: entra("cloud-entra"),
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `cloud-entra-${SUITE}`,
        issuer: entra("cloud-entra"),
        claims: { xms_edov: true },
      });

      const result = await signInThrough(providerId, { cloud: true });

      expect(result.error).toBe("OAuthAccountNotLinked");
      expect(result.session).toBeNull();
      expect(await linkedAccounts(user.id, providerId)).toEqual([]);
      expect(await addressConfirmed(user.id)).toBe(false);
    });
  });
});

/** The upgrade's data migration, applied the way `prisma migrate deploy`
 *  applies it. */
const TRAILING_SLASH_MIGRATION = readFileSync(
  new URL(
    "../../../prisma/migrations/20261001120000_sso_provider_entra_issuer_trailing_slash/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("given a Microsoft Entra ID connection whose issuer was stored with a trailing slash", () => {
  describe("when a guest signs in before and after the upgrade migration", () => {
    /** @scenario "A Microsoft Entra ID connection stored with a trailing slash signs in after the upgrade" */
    it("names the mismatch before, and signs in after without re-registering", async () => {
      const issuer = entra("slash");
      const { user, providerId } = await setUp({
        label: "entra-slash",
        state: "ACTIVE",
        domainVerified: true,
        issuer: `${issuer}/`,
      });
      const subject = `entra-slash-${SUITE}`;
      await identityProviderAsserts({
        email: user.email,
        subject,
        issuer,
        claims: {
          tid: `${SUITE}-slash`,
          oid: subject,
          idp: `https://sts.windows.net/${SUITE}-home-tenant/`,
        },
      });

      const before = await signInThrough(providerId);

      expect(before.error).toBe("sso_issuer_mismatch");
      expect(before.session).toBeNull();

      await prisma.$executeRawUnsafe(TRAILING_SLASH_MIGRATION);
      const after = await signInThrough(providerId);

      expect(after.error).toBeNull();
      expect(after.session?.user.id).toBe(user.id);
      expect(
        await prisma.ssoProvider.findFirstOrThrow({
          where: { providerId },
          select: { issuer: true },
        }),
      ).toEqual({ issuer });
    });
  });
});

describe("given a Microsoft Entra ID connection registered for one tenant", () => {
  describe("when a guest signs in with a token from another tenant", () => {
    /** @scenario "An ID token from another issuer is refused with both issuers named" */
    it("refuses with sso_issuer_mismatch and names the expected and received issuers", async () => {
      const expected = entra("app-tenant");
      const received = entra("home-tenant");
      const { user, providerId } = await setUp({
        label: "entra-other-tenant",
        state: "DRAFT",
        domainVerified: true,
        issuer: expected,
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `entra-other-tenant-${SUITE}`,
        issuer: received,
        claims: { idp: `https://sts.windows.net/${SUITE}-home-tenant/` },
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBe("sso_issuer_mismatch");
      const params = new URL(result.location, BASE_URL).searchParams;
      expect(params.get("expected_issuer")).toBe(expected);
      expect(params.get("received_issuer")).toBe(received);
      expect(params.get("error_description")).toBeNull();
      expect(result.session).toBeNull();
      expect(await linkedAccounts(user.id, providerId)).toEqual([]);
    });
  });
});

describe("given a Google Workspace connection", () => {
  describe("when its discovery document serves endpoints from googleapis.com", () => {
    /** @scenario "Google's endpoints on googleapis.com are trusted for a Google connection" */
    it("signs in through the endpoints the document names", async () => {
      const { user, providerId } = await setUp({
        label: "google",
        state: "ACTIVE",
        domainVerified: true,
        issuer: GOOGLE,
      });
      await identityProviderAsserts({
        email: user.email,
        subject: `google-${SUITE}`,
        issuer: GOOGLE,
        emailVerified: true,
      });

      const result = await signInThrough(providerId);

      expect(result.error).toBeNull();
      expect(result.session?.user.id).toBe(user.id);
    });
  });
});
