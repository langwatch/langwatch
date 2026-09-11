import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi, PinnedTrace } from "@langwatch/data-retention-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

/**
 * The `redis` member, for a test that never exercises the view-dedupe cache:
 * every scenario here either rejects before the cache is consulted or lists
 * with nothing to deduplicate, so nothing calls a method on this connection.
 *
 * It refuses on any access rather than being an empty object, so that claim is
 * enforced instead of merely asserted. A scenario that starts reaching the cache
 * fails here, naming the property, rather than somewhere downstream with
 * `undefined is not a function`.
 */
export function createShareTestRedis(): RedisConnection {
  return new Proxy({} as RedisConnection, {
    get(_target, property) {
      // Symbols are how a runtime inspects a value (promise-unwrapping, printing).
      // Refusing those would fail the test for looking at it, not for using it.
      if (typeof property === "symbol") return void 0;

      throw new Error(
        `The share installation test reached redis.${property}, which it is not meant to. ` +
          `Share is handed this member because it reads one; give the fixture real behaviour ` +
          `for the path you are adding rather than deleting this refusal.`,
      );
    },
  });
}

/** Every audience check permits, so a scoped link resolves without a directory. */
export function createShareTestAuthz(permitted = true): AuthzApi {
  return Object.assign(createApiFixture<AuthzApi>(), {
    getDecision: vi.fn(async () => ({ permitted })),
    isOnEngine: vi.fn(async () => false),
    attachResourceGrant: vi.fn(async () => void 0),
    revokeResourceGrants: vi.fn(async () => void 0),
  });
}

function pin(projectId: string, traceId: string): PinnedTrace {
  return {
    id: `pin_${traceId}`,
    projectId,
    traceId,
    userId: null,
    source: "share",
    reason: null,
    createdAt: new Date(0),
  };
}

export function createShareTestDataRetention(): DataRetentionApi {
  return Object.assign(createApiFixture<DataRetentionApi>(), {
    pin: vi.fn(async ({ projectId, traceId }: { projectId: string; traceId: string }) =>
      pin(projectId, traceId),
    ),
    autoPin: vi.fn(async ({ projectId, traceId }: { projectId: string; traceId: string }) =>
      pin(projectId, traceId),
    ),
    autoUnpin: vi.fn(async () => void 0),
    unpin: vi.fn(async () => void 0),
    findPin: vi.fn(async () => null),
    listByProject: vi.fn(async () => []),
  });
}

/** Both kill switches open, so a mint is only ever refused by the test that closes one. */
export function createShareTestProjects(): ProjectApi {
  return Object.assign(createApiFixture<ProjectApi>(), {
    findTraceSharingConfig: vi.fn(async () => ({ orgEnabled: true, projectEnabled: true })),
  });
}
