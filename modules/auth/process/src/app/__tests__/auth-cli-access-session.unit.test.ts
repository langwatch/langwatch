import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { cliAccessTokenKey } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { EmailDelivery } from "@langwatch/mail";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RateLimiter, SecretResolver } from "@langwatch/process-stores/members";
import { ScopedSecrets } from "@langwatch/secrets";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthApp } from "../auth.app.ts";
import { NO_SIGN_IN_PROVIDERS } from "./support/sign-in-providers.ts";

const ACCESS_TOKEN = "lw_at_active";
const AUTHORIZATION = `Bearer ${ACCESS_TOKEN}`;

async function appForCliSessions(repositories: MemoryAuthRepositories): Promise<AuthApp> {
  const secrets: SecretResolver = {
    find: () => void 0,
    read: (key) => {
      throw new Error(`test double does not stub secrets.read("${key}")`);
    },
  };

  return AuthApp.create({
    config: {
      sessionUrl: undefined,
      mfaEnrollmentOpen: false,
      passkeysEnabled: false,
      passkeyHandleSecret: undefined,
      trustedIdpOrigins: undefined,
      idpSimulatorUrl: undefined,
      localPasswords: false,
      signInProviders: NO_SIGN_IN_PROVIDERS,
    },
    repositories,
    dependencies: {
      users: createApiFixture<UserApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      identity: createApiFixture<IdentityApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      licensing: createApiFixture<LicensingApi>(),
      sso: createApiFixture<SsoApi>(),
      authz: createApiFixture<AuthzApi>({}),
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
    },
    members: {
      encryption: { encrypt: (value: string) => value, decrypt: (value: string) => value },
      logger: createLogger("langwatch:auth:test"),
      prisma: createApiFixture<PrismaClient>(),
      redis: createApiFixture(),
      rateLimiter: createApiFixture<RateLimiter>(),
      secrets,
      publicBaseUrl: void 0,
      identityEmails: void 0,
      mail: createApiFixture<EmailDelivery>(),
      invites: null,
      isSaas: false,
      nodeEnvironment: undefined,
      processName: "langwatch-api",
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(void 0)),
  });
}

describe("the Auth CLI access-session peer", () => {
  it("resolves the caller facts and the session's login key id, without exposing the token record", async () => {
    const repositories = MemoryAuthRepositories.create();
    await repositories.cliSessions.set({
      key: cliAccessTokenKey(ACCESS_TOKEN),
      value: JSON.stringify({
        user_id: "user-1",
        organization_id: "organization-1",
        issued_at: 0,
        expires_at: Date.now() + 60_000,
        client_info: { device_label: "Work laptop", hostname: "laptop" },
        cli_api_key_id: "cli-login-key-1",
      }),
      ttlSeconds: 60,
    });
    const app = await appForCliSessions(repositories);

    await expect(app.getCliAccessSession({ authorization: AUTHORIZATION })).resolves.toEqual({
      userId: "user-1",
      organizationId: "organization-1",
      tokenKey: cliAccessTokenKey(ACCESS_TOKEN),
      clientInfo: { deviceLabel: "Work laptop", hostname: "laptop" },
      cliApiKeyId: "cli-login-key-1",
    });
  });

  it.each([
    ["an unknown bearer", AUTHORIZATION],
    ["a bearer that is not a CLI access token", "Bearer sk-lw-project-key"],
  ])("refuses %s as invalid credentials", async (_label, authorization) => {
    const app = await appForCliSessions(MemoryAuthRepositories.create());

    await expect(app.getCliAccessSession({ authorization })).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("refuses an expired bearer as invalid credentials and drops its record", async () => {
    const repositories = MemoryAuthRepositories.create();
    await repositories.cliSessions.set({
      key: cliAccessTokenKey(ACCESS_TOKEN),
      value: JSON.stringify({
        user_id: "user-1",
        organization_id: "organization-1",
        issued_at: 0,
        expires_at: Date.now() - 1,
      }),
      ttlSeconds: 60,
    });
    const app = await appForCliSessions(repositories);

    await expect(app.getCliAccessSession({ authorization: AUTHORIZATION })).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("severs the presented bearer from Auth's token store and owner index", async () => {
    const repositories = MemoryAuthRepositories.create();
    await repositories.cliSessions.set({
      key: cliAccessTokenKey(ACCESS_TOKEN),
      value: JSON.stringify({
        user_id: "user-1",
        organization_id: "organization-1",
        issued_at: 0,
        expires_at: Date.now() + 60_000,
      }),
      ttlSeconds: 60,
    });
    await repositories.cliSessions.indexTokens({
      indexKey: "lwcli:user:user-1:tokens",
      memberKeys: [cliAccessTokenKey(ACCESS_TOKEN)],
      ttlMs: 60_000,
    });
    const app = await appForCliSessions(repositories);

    const { tokenKey } = await app.getCliAccessSession({ authorization: AUTHORIZATION });
    await app.revokeCliTokens({ userId: "user-1", tokenKeys: [tokenKey] });

    await expect(
      repositories.cliSessions.get(cliAccessTokenKey(ACCESS_TOKEN)),
    ).rejects.toMatchObject({ code: "cli_session_record_not_found" });
    expect(repositories.cliSessions.tokenIndexes.get("lwcli:user:user-1:tokens")).toEqual(
      new Set(),
    );
  });
});
