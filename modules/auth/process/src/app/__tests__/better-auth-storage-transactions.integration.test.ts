import { randomUUID } from "node:crypto";

/**
 * The storage Better Auth is composed with, against Postgres: it declares native transactions,
 * commits and rolls back together, and holds a provider row locked until the link finishes.
 * @see specs/identity/identity-storage-adapter.feature
 * @vitest-environment node
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { MemoryAuthChannels } from "../../channels/memory/memory.auth.channels.ts";
import { LiveAuthRepositories } from "../../repositories/live/live.auth.repositories.ts";
import { AuthModule } from "../auth.app.ts";
import { NO_SIGN_IN_PROVIDERS } from "./support/sign-in-providers.ts";
import { TestUserApi } from "./support/test-user-api.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const ns = `authtx-${randomUUID().slice(0, 8)}`;
const SECRET = "test-session-secret";
const HOLD_MS = 400;

const connection = PrismaConnectionService.create({
  guard: PrismaTenancyGuardService.create(),
  logger: createLogger("langwatch:auth:test:storage-transactions"),
}).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
const prisma = connection.client;

async function storage() {
  const app = await AuthModule.create({
    config: {
      sessionUrl: "https://app.langwatch.test",
      mfaEnrollmentOpen: false,
      passkeysEnabled: false,
      passkeyHandleSecret: "test-passkey-secret",
      trustedIdpOrigins: undefined,
      idpSimulatorUrl: undefined,
      localPasswords: false,
      auth0ManagementClientId: undefined,
      cliRefreshTokenTtlSeconds: undefined,
      isSaas: false,
      signInProviders: NO_SIGN_IN_PROVIDERS,
      signUpMode: "open",
      publicBaseUrl: undefined,
      nodeEnvironment: undefined,
    },
    repositories: LiveAuthRepositories.create({
      prisma,
      redis: null as never,
      rateLimiter: {} as never,
      encryption: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    }),
    dependencies: {
      projects: createApiFixture<ProjectApi>(),
      users: new TestUserApi({}) as never,
      apiKeys: { findResolvedToken: async () => null } as never,
      featureFlags: {} as never,
      identity: createApiFixture<IdentityApi>({ createStorageAdapter: ({ legacyEngine }) => legacyEngine }),
      organizations: createApiFixture<OrganizationApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      licensing: createApiFixture<LicensingApi>(),
      notifications: createApiFixture<NotificationService>(),
      sso: createApiFixture<SsoApi>({
        getSignInProviderMounts: async () => ({ socialProviders: {}, genericOAuthConfigs: [] }),
      }),
      authz: createApiFixture<AuthzApi>({}),
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
    },
    channels: MemoryAuthChannels.create(),
    resources: { own: () => undefined } as never,
    secrets: new ScopedSecrets(async (handle, build) =>
      build({ NEXTAUTH_SECRET: SECRET }[handle.id]),
    ),
  });
  const context = await (await app.betterAuth()).$context;

  return context.adapter;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function userData(label: string) {
  return {
    name: label,
    email: `${ns}-${label}@acme.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe.skipIf(!DB_URL)("the storage Better Auth is composed with", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: ns } } });
    await prisma.ssoProvider.deleteMany({ where: { providerId: { startsWith: ns } } });
  });
  afterAll(() => prisma.$disconnect());

  /** @scenario The adapter declares native transaction support */
  it("declares native transaction support, which single sign-on refuses to run without", async () => {
    const adapter = await storage();

    expect(typeof adapter.options?.adapterConfig.transaction).toBe("function");
  });

  /** @scenario Work inside a transaction commits together */
  it("makes two writes visible together once the callback returns", async () => {
    const adapter = await storage();

    await adapter.transaction(async (trx) => {
      await trx.create({ model: "user", data: userData("first") });
      await trx.create({ model: "user", data: userData("second") });
    });

    const rows = await prisma.user.findMany({ where: { email: { startsWith: ns } } });
    expect(rows).toHaveLength(2);
  });

  /** @scenario Work inside a transaction rolls back together */
  it("rolls the write back and hands the caller the original error when the callback throws", async () => {
    const adapter = await storage();
    const failure = new Error("the ceremony failed half way");

    const outcome = await adapter
      .transaction(async (trx) => {
        await trx.create({ model: "user", data: userData("doomed") });
        throw failure;
      })
      .catch((error: unknown) => error);

    expect(outcome).toBe(failure);
    await expect(prisma.user.count({ where: { email: { startsWith: ns } } })).resolves.toBe(0);
  });

  /** @scenario A provider row locked for a link holds until the link finishes */
  it("makes a second link for the same provider wait until the first transaction finishes", async () => {
    const adapter = await storage();
    const providerId = `${ns}-provider`;
    await prisma.ssoProvider.create({
      data: { id: `${ns}-row`, issuer: "https://idp.acme.com", providerId, domain: "acme.com" },
    });
    const lock = (trx: Pick<typeof adapter, "update">) =>
      trx.update({
        model: "ssoProvider",
        where: [{ field: "providerId", value: providerId }],
        update: { providerId },
      });
    const events: string[] = [];
    let firstHasLock!: () => void;
    const locked = new Promise<void>((resolve) => (firstHasLock = resolve));

    const first = adapter.transaction(async (trx) => {
      await lock(trx);
      firstHasLock();
      await sleep(HOLD_MS);
      events.push("first finished");
    });
    await locked;
    const second = adapter.transaction(async (trx) => {
      await lock(trx);
      events.push("second locked");
    });
    await Promise.all([first, second]);

    expect(events).toEqual(["first finished", "second locked"]);
  });
});
