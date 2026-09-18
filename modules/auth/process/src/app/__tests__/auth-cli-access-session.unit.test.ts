import { cliAccessTokenKey } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import { describe, expect, it } from "vitest";

import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthApp } from "../auth.app.ts";
import { TestUserApi } from "./support/test-user-api.ts";

const ACCESS_TOKEN = "lw_at_active";
const AUTHORIZATION = `Bearer ${ACCESS_TOKEN}`;

function redisForCliSessions() {
  const values = new Map<string, string>();
  const removed: string[][] = [];

  return {
    values,
    removed,
    get: async (key: string) => values.get(key) ?? null,
    del: async (key: string) => Number(values.delete(key)),
    srem: async (key: string, member: string) => {
      removed.push([key, member]);
      return 1;
    },
  };
}

function appForCliSessions(redis: ReturnType<typeof redisForCliSessions>): AuthApp {
  return AuthApp.create({
    config: {
      sessionUrl: undefined,
      mfaEnrollmentOpen: false,
      passkeysEnabled: false,
      passkeyHandleSecret: undefined,
    },
    repositories: MemoryAuthRepositories.create(),
    dependencies: {
      users: new TestUserApi({}) as never,
      apiKeys: {} as never,
      featureFlags: {} as never,
    },
    members: {
      logger: createLogger("langwatch:auth:test"),
      prisma: {} as never,
      redis: redis as never,
      rateLimiter: { check: async () => ({ allowed: true }) } as never,
      secrets: {
        find: () => undefined,
        read: (key: string) => {
          throw new Error(`test double does not stub secrets.read(\"${key}\")`);
        },
      },
      publicBaseUrl: undefined,
      identityEmails: undefined as never,
      rateLimit: undefined as never,
      route: undefined as never,
      signUp: null,
      invites: null,
      authProvider: undefined as never,
      federatedProvider: undefined,
      isSaas: false,
      processName: "langwatch-api",
    },
    resources: { own: () => undefined } as never,
    secrets: {} as never,
  });
}

describe("the Auth CLI access-session peer", () => {
  it("resolves the caller facts without exposing the token record", async () => {
    const redis = redisForCliSessions();
    redis.values.set(
      cliAccessTokenKey(ACCESS_TOKEN),
      JSON.stringify({
        user_id: "user-1",
        organization_id: "organization-1",
        issued_at: 0,
        expires_at: Date.now() + 60_000,
        client_info: { device_label: "Work laptop", hostname: "laptop" },
        cli_api_key_id: "key-secret-must-not-cross-the-peer-boundary",
      }),
    );
    const app = appForCliSessions(redis);

    await expect(app.findCliAccessSession({ authorization: AUTHORIZATION })).resolves.toEqual({
      userId: "user-1",
      organizationId: "organization-1",
      clientInfo: { deviceLabel: "Work laptop", hostname: "laptop" },
    });
  });

  it("severs the presented bearer from Auth's token store and owner index", async () => {
    const redis = redisForCliSessions();
    redis.values.set(
      cliAccessTokenKey(ACCESS_TOKEN),
      JSON.stringify({
        user_id: "user-1",
        organization_id: "organization-1",
        issued_at: 0,
        expires_at: Date.now() + 60_000,
      }),
    );
    const app = appForCliSessions(redis);

    await app.revokeCliAccessToken({ authorization: AUTHORIZATION, userId: "user-1" });

    expect(redis.values.has(cliAccessTokenKey(ACCESS_TOKEN))).toBe(false);
    expect(redis.removed).toEqual([["lwcli:user:user-1:tokens", cliAccessTokenKey(ACCESS_TOKEN)]]);
  });
});
