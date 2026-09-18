import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { cliAccessTokenKey } from "@langwatch/auth-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { ResourceScope } from "@langwatch/kernel";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RateLimiter, SecretResolver } from "@langwatch/process-stores/members";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthApp } from "../auth.app.ts";

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
    },
    repositories,
    dependencies: {
      users: createApiFixture<UserApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
    },
    members: {
      logger: createLogger("langwatch:auth:test"),
      prisma: createApiFixture<PrismaClient>(),
      redis: createApiFixture(),
      rateLimiter: createApiFixture<RateLimiter>(),
      secrets,
      publicBaseUrl: void 0,
      identityEmails: void 0,
      rateLimit: void 0,
      route: void 0,
      signUp: null,
      invites: null,
      authProvider: void 0,
      federatedProvider: void 0,
      isSaas: false,
      processName: "langwatch-api",
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(void 0)),
  });
}

describe("the Auth CLI access-session peer", () => {
  it("resolves the caller facts without exposing the token record", async () => {
    const repositories = MemoryAuthRepositories.create();
    await repositories.cliSessions.set({
      key: cliAccessTokenKey(ACCESS_TOKEN),
      value: JSON.stringify({
        user_id: "user-1",
        organization_id: "organization-1",
        issued_at: 0,
        expires_at: Date.now() + 60_000,
        client_info: { device_label: "Work laptop", hostname: "laptop" },
        cli_api_key_id: "key-secret-must-not-cross-the-peer-boundary",
      }),
      ttlSeconds: 60,
    });
    const app = await appForCliSessions(repositories);

    await expect(app.findCliAccessSession({ authorization: AUTHORIZATION })).resolves.toEqual({
      userId: "user-1",
      organizationId: "organization-1",
      clientInfo: { deviceLabel: "Work laptop", hostname: "laptop" },
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

    await app.revokeCliAccessToken({ authorization: AUTHORIZATION, userId: "user-1" });

    await expect(
      repositories.cliSessions.tryGet(cliAccessTokenKey(ACCESS_TOKEN)),
    ).resolves.toBeNull();
    expect(repositories.cliSessions.tokenIndexes.get("lwcli:user:user-1:tokens")).toEqual(
      new Set(),
    );
  });
});
