import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { cliAccessTokenKey, cliRefreshTokenKey } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryAuthChannels } from "../../channels/memory/memory.auth.channels.ts";
import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthModule } from "../auth.app.ts";
import { NO_SIGN_IN_PROVIDERS } from "./support/sign-in-providers.ts";

const ACCESS_TOKEN = "lw_at_active";
const AUTHORIZATION = `Bearer ${ACCESS_TOKEN}`;
const REFRESH_TOKEN = "lw_rt_active";

/** The bearer's person as the user module stores them; `deactivatedAt` is the switch. */
function person({ deactivatedAt = null }: { deactivatedAt?: Date | null } = {}): UserProfile {
  return {
    id: "user-1",
    name: "Jane",
    email: "jane@example.test",
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt,
  };
}

/** Where the bearer's person stands: switched off, and whether their seat still counts. */
type Standing = { deactivatedAt?: Date | null; activeMember?: boolean };

async function appForCliSessions(
  repositories: MemoryAuthRepositories,
  { deactivatedAt = null, activeMember = true }: Standing = {},
): Promise<AuthModule> {
  return AuthModule.create({
    config: {
      sessionUrl: undefined,
      mfaEnrollmentOpen: false,
      passkeysEnabled: false,
      passkeyHandleSecret: undefined,
      trustedIdpOrigins: undefined,
      idpSimulatorUrl: undefined,
      localPasswords: false,
      socialProviderBases: {
        google: undefined,
        github: undefined,
        gitlab: undefined,
        microsoft: undefined,
      },
      cliRefreshTokenTtlSeconds: undefined,
      isSaas: false,
      signInProviders: NO_SIGN_IN_PROVIDERS,
      signUpMode: "open",
      publicBaseUrl: void 0,
      nodeEnvironment: undefined,
    },
    repositories,
    dependencies: {
      projects: createApiFixture<ProjectApi>(),
      users: createApiFixture<UserApi>({
        findById: async () => person({ deactivatedAt }),
      }),
      apiKeys: createApiFixture<ApiKeyApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      identity: createApiFixture<IdentityApi>({
        createStorageAdapter: ({ legacyEngine }) => legacyEngine,
      }),
      organizations: createApiFixture<OrganizationApi>({
        isMember: async () => activeMember,
        getSessionPolicy: async () => ({ maxSessionDurationDays: 0 }),
      }),
      entitlements: createApiFixture<EntitlementApi>(),
      notifications: createApiFixture<NotificationService>(),
      sso: createApiFixture<SsoApi>(),
      authz: createApiFixture<AuthzApi>({}),
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
    },
    channels: MemoryAuthChannels.create({
      bound: { notifications: createApiFixture<NotificationService>() },
    }),
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

  describe("when the bearer's person no longer stands in the organization", () => {
    const switchedOff: readonly [string, Standing][] = [
      ["a deactivated person", { deactivatedAt: new Date(1) }],
      ["a disabled or removed membership", { activeMember: false }],
    ];

    async function seedSession(repositories: MemoryAuthRepositories): Promise<void> {
      const record = {
        user_id: "user-1",
        organization_id: "organization-1",
        project_id: "project-1",
        issued_at: 0,
        expires_at: Date.now() + 60_000,
      };
      await repositories.cliSessions.set({
        key: cliAccessTokenKey(ACCESS_TOKEN),
        value: JSON.stringify(record),
        ttlSeconds: 60,
      });
      await repositories.cliSessions.set({
        key: cliRefreshTokenKey(REFRESH_TOKEN),
        value: JSON.stringify(record),
        ttlSeconds: 60,
      });
    }

    it.each(switchedOff)(
      "refuses the access session of %s as invalid credentials",
      async (_label, standing) => {
        const repositories = MemoryAuthRepositories.create();
        await seedSession(repositories);
        const app = await appForCliSessions(repositories, standing);

        await expect(
          app.getCliAccessSession({ authorization: AUTHORIZATION }),
        ).rejects.toMatchObject({ code: "invalid_credentials" });
      },
    );

    it.each(switchedOff)(
      "refuses the project-bound access of %s as invalid credentials",
      async (_label, standing) => {
        const repositories = MemoryAuthRepositories.create();
        await seedSession(repositories);
        const app = await appForCliSessions(repositories, standing);

        await expect(
          app.getCliAccessProject({ authorization: AUTHORIZATION }),
        ).rejects.toMatchObject({ code: "invalid_credentials" });
      },
    );

    it.each(switchedOff)("refuses to rotate the session of %s", async (_label, standing) => {
      const repositories = MemoryAuthRepositories.create();
      await seedSession(repositories);
      const app = await appForCliSessions(repositories, standing);

      await expect(app.refreshCliSession({ refreshToken: REFRESH_TOKEN })).rejects.toMatchObject({
        code: "cli_device_flow_refused",
      });
    });
  });
});
