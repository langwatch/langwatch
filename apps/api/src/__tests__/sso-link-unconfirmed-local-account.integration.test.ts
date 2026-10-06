/**
 * @vitest-environment node
 * SSO onto an unconfirmed password account through the installed api's sign-in door, with auth,
 * identity, organization and user over a live Postgres. Only the identity provider is stubbed.
 * @see specs/identity/sso-link-unconfirmed-local-account.feature
 */
import { readFileSync } from "node:fs";

import { ClientAddress } from "@langwatch/api/policy";
import { RestHost } from "@langwatch/api/rest";
import { AuthApi, normalizeSignInErrorCode } from "@langwatch/auth-contract";
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  bootInstalledProcess,
  storesBackedMembers,
  withMemoryRepositories,
  type InstallableServerFeature,
  processConfig,
} from "@langwatch/process";
import {
  aesEncryption,
  memoryStores,
  resolvedSecrets,
  systemClock,
  type ProcessMembers,
} from "@langwatch/process-stores";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { processModules } from "../process-modules.generated.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:test:sso-link-unconfirmed"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

const BASE_URL = "http://localhost:3000";
const SUITE = nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x");
const DOMAIN = `${SUITE}.unconfirmed-link-test.example`;
const IDP = `https://idp-${SUITE}.unconfirmed-link-test.example`;
const ENTRA_HOST = "https://login.microsoftonline.com";
/** One Entra tenant per connection, since an issuer routes to a single connection. */
const entra = (label: string) => `${ENTRA_HOST}/${SUITE}-${label}/v2.0`;
const GRAPH_USERINFO = "https://graph.microsoft.com/oidc/userinfo";
const CLIENT_ID = "langwatch-test-client";

/**
 * The modules a federated sign-in reads and writes. memoryStores() states the memory tier for the
 * whole process (ARCHITECTURE.md §7), so none of these runs live: the suite stays red until it can.
 */
const LIVE_MODULES: ReadonlySet<string> = new Set(["auth", "identity", "organization", "user"]);

const organizationIds: string[] = [];
const connectionIds: string[] = [];
const userIds: string[] = [];

function unreachable<Client extends object>(name: string): Client {
  return new Proxy({} as Client, {
    get: (_target, property) => {
      throw new Error(`${name}.${String(property)} is not reachable in this suite`);
    },
  });
}

function tierOf(module: InstallableServerFeature<never>): InstallableServerFeature<never> {
  if (LIVE_MODULES.has(module.name) || module.repositoryRegistry === void 0) return module;
  return withMemoryRepositories(module);
}

/** The api, installed as `main.ts` installs it, with the sign-in door mounted on a host. */
async function bootInstallation({ cloud }: { cloud: boolean }) {
  const environment: Record<string, string> = {
    NODE_ENV: "test",
    BASE_HOST: BASE_URL,
    NEXTAUTH_URL: BASE_URL,
    NEXTAUTH_SECRET: "test-secret-test-secret-test-secret",
    API_KEY_PEPPER: "synthetic-api-key-pepper",
    ...(cloud ? { IS_SAAS: "true" } : {}),
  };
  const owners = processConfig(processModules, "api");
  const config = parseProcessConfig({ owners, environment });
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  const eventing = new EventSourcing({
    enabled: false,
    participation: "produce",
    processManagerMode: "producer-only",
  });
  const runtime = await bootInstalledProcess({
    role: "api",
    modules: processModules.map(tierOf),
    config,
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    members: {
      ...storesBackedMembers(memoryStores(), {
        logger: createTestLogger().logger,
        clock: systemClock(),
        secrets: resolvedSecrets({}),
        encryption: aesEncryption(new Uint8Array(32)),
        telemetry: unreachable<ProcessMembers["telemetry"]>("telemetry"),
        prisma,
        clickhouse: unreachable<ProcessMembers["clickhouse"]>("clickhouse"),
        objectStorage: unreachable<ProcessMembers["objectStorage"]>("objectStorage"),
        cache: unreachable<ProcessMembers["cache"]>("cache"),
        idempotency: { claim: async () => true },
        rateLimiter: { check: async () => ({ allowed: true }) },
        eventing,
        redis: rateLimitingRedis(),
        publicBaseUrl: config.process.baseHost,
        serviceVersion: "test",
        telemetryExporter: {
          endpoint: void 0,
          withHeaders: <Out>(build: (headers: Readonly<Record<string, string>>) => Out): Out =>
            build({}),
        },
        nodeEnvironment: config.process.nodeEnvironment,
        isSaas: config.process.isSaas ?? false,
        nlpServiceUrl: config.process.nlpServiceUrl,
        nlpCodeBlockTimeoutSeconds: config.process.nlpCodeBlockTimeoutSeconds,
        nlpInternalSecret: void 0,
        outboundProxy: config.process.outboundProxy,
        processName: "langwatch-api",
        storageResolver: void 0,
        storage: void 0,
        queue: void 0,
        content: void 0,
        connectJudge: null,
        monitor: void 0,
        langwatchQl: {
          admin: { configured: false },
          postgres: { configured: false },
          database: () => prisma,
        },
      }),
      close: async () => void 0,
    },
  });

  const closed = {
    authenticate: () => {
      throw new Error("the sign-in door authenticates nobody itself");
    },
  };
  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  const door = processModules
    .filter((module) => module.apiContract === AuthApi)
    .flatMap((module) => module.transports ?? [])
    .find((transport) => transport.protocol === "rest" && transport.namespace === "auth");
  if (!door) throw new Error("no installed module declares the auth family");
  host.mount(door.router(), () => runtime.service(AuthApi));

  // Resolved once per request, as the mux does before routing: the browser's own address.
  const callers = ClientAddress.classifyByAddress();
  return {
    runtime,
    fetch: (request: Request, browser: string) => {
      callers.handle({ request, socketAddress: browser });
      return host.app.fetch(request);
    },
  };
}

type Installation = Awaited<ReturnType<typeof bootInstallation>>;

let browsers = 0;

let idToken = "";
let jwks: { keys: unknown[] } = { keys: [] };
/** What Microsoft Graph's userinfo answers: the profile, with no verification claim. */
let graphUserInfo: Record<string, unknown> = {};
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
  const header = base64url(JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" }));
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
      { kty: exported.kty, n: exported.n, e: exported.e, alg: "RS256", kid: "test", use: "sig" },
    ],
  };
}

/** The ID token the provider signs. No `emailVerified` sends no `email_verified` claim at all,
 *  the way Entra ID signs its tokens; `claims` adds the rest (`xms_edov`). */
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

const respond = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
};

/** An Entra ID tenant's discovery document as Microsoft serves it: sign-in endpoints under the
 *  tenant on `login.microsoftonline.com`, userinfo on Microsoft Graph. */
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
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "name", "tid", "ver", "email"],
  };
}

const tokenResponse = () => ({
  access_token: `access-${SUITE}`,
  id_token: idToken,
  token_type: "Bearer",
  expires_in: 3600,
});

/** The identity providers' side of every sign-in; everything else goes out as usual. */
function stubIdentityProviders() {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith(GRAPH_USERINFO)) return respond(graphUserInfo);
    if (url.startsWith(`${ENTRA_HOST}/`)) {
      if (url.includes("/.well-known/openid-configuration")) {
        return respond(entraDiscovery((url.split("/.well-known/")[0] ?? "").replace(/\/+$/, "")));
      }
      if (url.includes("/oauth2/v2.0/token")) return respond(tokenResponse());
      if (url.includes("/discovery/v2.0/keys")) return respond(jwks);
    }
    if (!url.startsWith(IDP)) return realFetch(input, init);
    if (url.startsWith(`${IDP}/.well-known/openid-configuration`)) {
      return respond({
        issuer: IDP,
        authorization_endpoint: `${IDP}/authorize`,
        token_endpoint: `${IDP}/token`,
        jwks_uri: `${IDP}/jwks`,
      });
    }
    if (url.startsWith(`${IDP}/token`)) return respond(tokenResponse());
    if (url.startsWith(`${IDP}/jwks`)) return respond(jwks);
    return realFetch(input, init);
  }) as typeof globalThis.fetch;
}

/** A password account created without inbox proof, the way a sign-up on an installation with
 *  no mailer creates it. */
async function passwordAccount({
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
    data: { email, name: "Password profile", emailVerified: confirmed },
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

/** The connection's projection and the engine row identity projects from it. */
async function ssoConnection({
  organizationId,
  state,
  domainVerified,
  createdBy,
  issuer,
}: {
  organizationId: string;
  state: "ACTIVE" | "DRAFT";
  domainVerified: boolean;
  createdBy: string;
  issuer: string;
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
            },
          ]
        : [],
      lapsedDomains: [],
      idpMetadata: {
        issuer: issuer.replace(/\/+$/, ""),
        providerId: id,
        clientIdRef: null,
        secretRef: null,
        certRefs: [],
      },
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
  const isEntra = issuer.startsWith(`${ENTRA_HOST}/`);
  await prisma.ssoProvider.create({
    data: {
      id: `ssoprov_${nanoid(12)}`,
      providerId: id,
      issuer,
      domain: DOMAIN,
      // An Entra ID connection carries only its discovery endpoint, so the engine reads the
      // rest, userinfo included, from discovery at sign-in.
      oidcConfig: JSON.stringify({
        clientId: CLIENT_ID,
        clientSecret: "langwatch-test-secret",
        discoveryEndpoint: `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
        ...(isEntra
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

/** One organization, its administrator's password account, and the organization's one
 *  connection, registered by that administrator. */
async function setUp({
  label,
  state,
  domainVerified,
  issuer = IDP,
  confirmed,
}: {
  label: string;
  state: "ACTIVE" | "DRAFT";
  domainVerified: boolean;
  issuer?: string;
  confirmed?: boolean;
}) {
  const organizationId = `unconfirmed-link-${label}-${SUITE}`;
  organizationIds.push(organizationId);
  await prisma.organization.create({
    data: { id: organizationId, name: label, slug: organizationId },
  });
  const user = await passwordAccount({ label, organizationId, confirmed });
  const providerId = await ssoConnection({
    organizationId,
    state,
    domainVerified,
    createdBy: user.id,
    issuer,
  });
  return { user, providerId };
}

/**
 * The in-process Redis, with the one script Better Auth's rate limiter runs: an increment
 * that sets the expiry, which an in-process store never enforces anyway.
 */
function rateLimitingRedis(): ReturnType<typeof memoryRedisDouble> {
  const redis: ReturnType<typeof memoryRedisDouble> = memoryRedisDouble({
    script: { eval: async (...args: unknown[]) => redis.incr(String(args[2])) },
  });
  return redis;
}

const startedSchema = z.object({ url: z.string() });
const sessionSchema = z.object({ user: z.object({ id: z.string() }) }).nullable();

const cookiesOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((set) => set.split(";")[0])
    .join("; ");

/** A browser starting the sign-in on the sign-in page and returning from the provider. */
async function signInThrough(installation: Installation, providerId: string) {
  // A browser of its own, so one test's sign-ins never spend another's rate-limit budget.
  browsers += 1;
  const browser = `203.0.113.${browsers}`;
  const started = await installation.fetch(
    new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ providerId, callbackURL: `${BASE_URL}/dashboard` }),
    }),
    browser,
  );
  const authorize = new URL(startedSchema.parse(await started.json()).url);
  const state = authorize.searchParams.get("state") ?? "";
  const callback = await installation.fetch(
    new Request(
      `${BASE_URL}/api/auth/sso/callback/${providerId}?code=test-code&state=${encodeURIComponent(state)}`,
      { method: "GET", redirect: "manual", headers: { cookie: cookiesOf(started) } },
    ),
    browser,
  );
  const location = callback.headers.get("location") ?? "";
  const polled = await installation.fetch(
    new Request(`${BASE_URL}/api/auth/session`, { headers: { cookie: cookiesOf(callback) } }),
    browser,
  );
  const session = sessionSchema.parse(await polled.json());
  const error = new URL(location, BASE_URL).searchParams.get("error");
  return { location, session, error: normalizeSignInErrorCode(error) };
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

/** The upgrade's data migration, applied the way `prisma migrate deploy` applies it. */
const TRAILING_SLASH_MIGRATION = readFileSync(
  new URL(
    "../../../../packages/prisma-client/prisma/migrations/20261001120000_sso_provider_entra_issuer_trailing_slash/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe.skipIf(!databaseUrl)("single sign-on onto an existing password account", () => {
  let selfHosted: Installation;
  let cloud: Installation;

  beforeAll(async () => {
    stubIdentityProviders();
    selfHosted = await bootInstallation({ cloud: false });
    cloud = await bootInstallation({ cloud: true });
  }, 60_000);

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await Promise.all([selfHosted?.runtime.stop(), cloud?.runtime.stop()]);
    await prisma.ssoProvider.deleteMany({ where: { providerId: { in: connectionIds } } });
    for (const userId of userIds) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.account.deleteMany({ where: { userId } });
      await prisma.identifier.deleteMany({ where: { userId } });
      await prisma.organizationUser.deleteMany({
        where: { userId, organizationId: { in: organizationIds } },
      });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.ssoConnection.deleteMany({ where: { id: { in: connectionIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.verificationToken.deleteMany({
      where: { OR: connectionIds.map((id) => ({ identifier: { contains: id } })) },
    });
    await connection?.closeOnce();
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
        await identityProviderAsserts({ email: user.email, subject, emailVerified: true });

        const first = await signInThrough(selfHosted, providerId);

        expect(first.error).toBeNull();
        expect(first.location).toBe(`${BASE_URL}/dashboard`);
        expect(first.session?.user.id).toBe(user.id);
        expect(await addressConfirmed(user.id)).toBe(true);
        expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
        const binding = await linkedAccounts(user.id, providerId);
        expect(binding).toEqual([{ id: expect.any(String), providerAccountId: subject }]);

        const repeated = await signInThrough(selfHosted, providerId);

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

        const result = await signInThrough(selfHosted, providerId);

        expect(result.error).toBeNull();
        expect(result.session?.user.id).toBe(admin.id);
        expect(await addressConfirmed(admin.id)).toBe(true);
        expect(await linkedAccounts(admin.id, providerId)).toHaveLength(1);
      });
    });

    describe("when its registrant runs the setup test sign-in before the domain is verified", () => {
      /** @scenario "An unconfirmed account on a domain the connection has not verified is not linked" */
      it.each([
        { label: "unproved-vouched", issuer: IDP, emailVerified: true },
        { label: "unproved-silent", issuer: entra("unproved-silent"), emailVerified: undefined },
      ])(
        "refuses $label with the named code and leaves the account as it was",
        async ({ label, issuer, emailVerified }) => {
          const { user: admin, providerId } = await setUp({
            label,
            state: "DRAFT",
            domainVerified: false,
            issuer,
          });
          await identityProviderAsserts({
            email: admin.email,
            subject: `${label}-${SUITE}`,
            issuer,
            emailVerified,
          });

          const result = await signInThrough(selfHosted, providerId);

          expect(result.error).toBe("sso_existing_account_unconfirmed");
          expect(result.session).toBeNull();
          expect(await linkedAccounts(admin.id, providerId)).toEqual([]);
          expect(await addressConfirmed(admin.id)).toBe(false);
        },
      );
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

        const result = await signInThrough(selfHosted, providerId);

        expect(result.error).toBe("sso_existing_account_unconfirmed");
        expect(result.session).toBeNull();
        expect(await linkedAccounts(user.id, providerId)).toEqual([]);
        expect(await addressConfirmed(user.id)).toBe(false);
      });
    });

    describe("when the account is deactivated or another account holds its identity", () => {
      /** @scenario "A deactivated or contested unconfirmed account is not linked" */
      it.each(["deactivated", "address-held-elsewhere", "subject-held-elsewhere"])(
        "refuses the %s account and leaves it as it was",
        async (kind) => {
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
            const holdsSubject = kind === "subject-held-elsewhere";
            await prisma.identifier.create({
              data: {
                id: `${kind}-identifier-${SUITE}`,
                userId: other.id,
                provider: "oidc",
                state: "VERIFIED",
                value: holdsSubject ? `unrelated-${SUITE}@${DOMAIN}` : user.email,
                issuer: holdsSubject ? IDP : null,
                providerId: holdsSubject ? providerId : null,
                providerAccountId: holdsSubject ? subject : null,
                attachedAt: new Date(),
              },
            });
          }
          await identityProviderAsserts({ email: user.email, subject, emailVerified: true });

          const result = await signInThrough(selfHosted, providerId);

          expect(result.error).toBe("OAuthAccountNotLinked");
          expect(result.session).toBeNull();
          expect(await linkedAccounts(user.id, providerId)).toEqual([]);
          expect(await addressConfirmed(user.id)).toBe(false);
        },
      );
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
      ])(
        "signs $label in to the same account through the binding it already holds",
        async ({ label, state, domainVerified, emailVerified }) => {
          const { user, providerId } = await setUp({ label, state, domainVerified });
          const subject = `${label}-${SUITE}`;
          await prisma.account.create({
            data: {
              userId: user.id,
              provider: providerId,
              issuer: IDP,
              providerAccountId: subject,
            },
          });
          await identityProviderAsserts({ email: user.email, subject, emailVerified });

          const result = await signInThrough(selfHosted, providerId);

          expect(result.error).toBeNull();
          expect(result.session?.user.id).toBe(user.id);
          expect(await linkedAccounts(user.id, providerId)).toHaveLength(1);
        },
      );
    });

    describe("when Microsoft Entra ID signs it in with no email_verified and no xms_edov claim", () => {
      /** @scenario "Microsoft Entra ID links an unconfirmed password account without sending email_verified" */
      it("links the existing account, confirms the address and reuses the binding", async () => {
        const issuer = entra("entra-silent");
        const { user, providerId } = await setUp({
          label: "entra-silent",
          state: "ACTIVE",
          domainVerified: true,
          issuer,
        });
        const subject = `entra-silent-${SUITE}`;
        await identityProviderAsserts({
          email: user.email,
          subject,
          issuer,
          claims: { tid: `${SUITE}-tenant`, oid: subject },
        });

        const first = await signInThrough(selfHosted, providerId);

        expect(first.error).toBeNull();
        expect(first.session?.user.id).toBe(user.id);
        expect(await addressConfirmed(user.id)).toBe(true);
        expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
        const binding = await linkedAccounts(user.id, providerId);
        expect(binding).toEqual([{ id: expect.any(String), providerAccountId: subject }]);

        const repeated = await signInThrough(selfHosted, providerId);

        expect(repeated.session?.user.id).toBe(user.id);
        expect(await linkedAccounts(user.id, providerId)).toEqual(binding);
      });

      /** @scenario "Microsoft Entra ID links an unconfirmed password account without sending email_verified" */
      it("reads the profile from Microsoft Graph's userinfo, an origin the issuer does not name", async () => {
        const issuer = entra("entra-graph");
        const { user, providerId } = await setUp({
          label: "entra-graph",
          state: "ACTIVE",
          domainVerified: true,
          issuer,
        });
        await identityProviderAsserts({
          email: user.email,
          subject: `entra-graph-${SUITE}`,
          issuer,
        });
        const dialed: string[] = [];
        const stubbed = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          dialed.push(requestUrl(input));
          return stubbed(input, init);
        }) as typeof globalThis.fetch;

        try {
          const result = await signInThrough(selfHosted, providerId);

          expect(result.error).toBeNull();
          expect(result.session?.user.id).toBe(user.id);
          expect(dialed).toContain(GRAPH_USERINFO);
        } finally {
          globalThis.fetch = stubbed;
        }
      });
    });

    describe("when Microsoft Entra ID sends xms_edov true", () => {
      /** @scenario "Microsoft Entra ID's xms_edov true links an unconfirmed password account" */
      it("links the existing account and confirms the address", async () => {
        const issuer = entra("entra-edov");
        const { user, providerId } = await setUp({
          label: "entra-edov",
          state: "DRAFT",
          domainVerified: true,
          issuer,
        });
        await identityProviderAsserts({
          email: user.email,
          subject: `entra-edov-${SUITE}`,
          issuer,
          claims: { xms_edov: true },
        });

        const result = await signInThrough(selfHosted, providerId);

        expect(result.error).toBeNull();
        expect(result.session?.user.id).toBe(user.id);
        expect(await addressConfirmed(user.id)).toBe(true);
        expect(await linkedAccounts(user.id, providerId)).toHaveLength(1);
      });
    });

    describe("when Microsoft Entra ID sends xms_edov false", () => {
      /** @scenario "Microsoft Entra ID's xms_edov false does not link an unconfirmed account" */
      it("refuses with the named code and leaves the account as it was", async () => {
        const issuer = entra("entra-edov-false");
        const { user, providerId } = await setUp({
          label: "entra-edov-false",
          state: "ACTIVE",
          domainVerified: true,
          issuer,
        });
        await identityProviderAsserts({
          email: user.email,
          subject: `entra-edov-false-${SUITE}`,
          issuer,
          claims: { xms_edov: false },
        });

        const result = await signInThrough(selfHosted, providerId);

        expect(result.error).toBe("sso_existing_account_unconfirmed");
        expect(result.session).toBeNull();
        expect(await linkedAccounts(user.id, providerId)).toEqual([]);
        expect(await addressConfirmed(user.id)).toBe(false);
      });
    });
  });

  describe("given a password account whose address is confirmed", () => {
    describe("when Microsoft Entra ID signs it in with no email_verified claim", () => {
      /** @scenario "A confirmed password account links when the provider sends no email_verified" */
      it("links the existing account instead of refusing it", async () => {
        const issuer = entra("entra-confirmed");
        const { user, providerId } = await setUp({
          label: "entra-confirmed",
          state: "ACTIVE",
          domainVerified: true,
          issuer,
          confirmed: true,
        });
        await identityProviderAsserts({
          email: user.email,
          subject: `entra-confirmed-${SUITE}`,
          issuer,
        });

        const result = await signInThrough(selfHosted, providerId);

        expect(result.error).toBeNull();
        expect(result.session?.user.id).toBe(user.id);
        expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
        expect(await linkedAccounts(user.id, providerId)).toHaveLength(1);
      });
    });

    describe("when Microsoft Entra ID sends xms_edov true and the domain is not verified", () => {
      /** @scenario "Microsoft Entra ID's xms_edov true links a confirmed account without a domain proof" */
      it("links the existing account on the provider's word", async () => {
        const issuer = entra("entra-confirmed-edov");
        const { user, providerId } = await setUp({
          label: "entra-confirmed-edov",
          state: "DRAFT",
          domainVerified: false,
          issuer,
          confirmed: true,
        });
        await identityProviderAsserts({
          email: user.email,
          subject: `entra-confirmed-edov-${SUITE}`,
          issuer,
          claims: { xms_edov: true },
        });

        const result = await signInThrough(selfHosted, providerId);

        expect(result.error).toBeNull();
        expect(result.session?.user.id).toBe(user.id);
        expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
        expect(await linkedAccounts(user.id, providerId)).toHaveLength(1);
      });
    });

    describe("when a provider that sends no email_verified signs it in before the domain is verified", () => {
      /** @scenario "A confirmed account on a domain the connection has not verified is refused with the missing proof named" */
      it("refuses with sso_domain_not_verified and leaves the account as it was", async () => {
        const issuer = entra("entra-confirmed-unproved");
        const { user, providerId } = await setUp({
          label: "entra-confirmed-unproved",
          state: "DRAFT",
          domainVerified: false,
          issuer,
          confirmed: true,
        });
        await identityProviderAsserts({
          email: user.email,
          subject: `entra-confirmed-unproved-${SUITE}`,
          issuer,
        });

        const result = await signInThrough(selfHosted, providerId);

        expect(result.error).toBe("sso_domain_not_verified");
        expect(result.session).toBeNull();
        expect(await linkedAccounts(user.id, providerId)).toEqual([]);
        expect(await addressConfirmed(user.id)).toBe(true);
      });
    });
  });

  describe("given an unconfirmed password account on LangWatch Cloud", () => {
    describe("when the identity provider asserts the address is verified", () => {
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

        const result = await signInThrough(cloud, providerId);

        expect(result.error).toBe("OAuthAccountNotLinked");
        expect(result.session).toBeNull();
        expect(await linkedAccounts(user.id, providerId)).toEqual([]);
        expect(await addressConfirmed(user.id)).toBe(false);
      });
    });

    describe("when Microsoft Entra ID sends xms_edov true and no email_verified claim", () => {
      /** @scenario "On LangWatch Cloud a provider that sends no email_verified does not link an existing account" */
      it("keeps better-auth's own refusal and leaves the account as it was", async () => {
        const issuer = entra("cloud-entra");
        const { user, providerId } = await setUp({
          label: "cloud-entra",
          state: "ACTIVE",
          domainVerified: true,
          issuer,
        });
        await identityProviderAsserts({
          email: user.email,
          subject: `cloud-entra-${SUITE}`,
          issuer,
          claims: { xms_edov: true },
        });

        const result = await signInThrough(cloud, providerId);

        expect(result.error).toBe("OAuthAccountNotLinked");
        expect(result.session).toBeNull();
        expect(await linkedAccounts(user.id, providerId)).toEqual([]);
        expect(await addressConfirmed(user.id)).toBe(false);
      });
    });
  });

  describe("given a Microsoft Entra ID connection whose issuer was stored with a trailing slash", () => {
    describe("when a guest signs in before and after the upgrade migration", () => {
      /** @scenario "A Microsoft Entra ID connection stored with a trailing slash signs in after the upgrade" */
      it("names the mismatch before, and signs in after without registering again", async () => {
        const issuer = entra("slash");
        const { user, providerId } = await setUp({
          label: "entra-slash",
          state: "ACTIVE",
          domainVerified: true,
          issuer: `${issuer}/`,
        });
        await identityProviderAsserts({
          email: user.email,
          subject: `entra-slash-${SUITE}`,
          issuer,
        });

        const before = await signInThrough(selfHosted, providerId);

        expect(before.error).toBe("sso_issuer_mismatch");
        expect(before.session).toBeNull();

        await prisma.$executeRawUnsafe(TRAILING_SLASH_MIGRATION);
        const after = await signInThrough(selfHosted, providerId);

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

        const result = await signInThrough(selfHosted, providerId);

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
});
