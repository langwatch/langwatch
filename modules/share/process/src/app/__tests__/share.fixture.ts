import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi, PinnedTrace } from "@langwatch/data-retention-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

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
