import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { OrganizationApi, User } from "@langwatch/organization-contract";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { vi } from "vitest";

import type { AnnotationRepositories } from "../../repositories/annotation.repositories.ts";
import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";
import { AnnotationApp } from "../annotation.app.ts";

export function createAnnotationTestProjects(organizationId = "organization-1") {
  return Object.assign(createApiFixture<ProjectApi>(), {
    getOrganizationId: vi.fn(async () => organizationId),
  });
}

type TestOrganizationMember = string | Pick<User, "id" | "name" | "image">;

function organizationMember(member: TestOrganizationMember): User {
  const { id, name, image } =
    typeof member === "string" ? { id: member, name: null, image: null } : member;

  return {
    id,
    name,
    email: null,
    emailVerified: true,
    image,
    pendingSsoSetup: false,
    userHashKey: null,
    twoFactorEnabled: false,
    createdAt: Temporal.Instant.fromEpochMilliseconds(0),
    updatedAt: Temporal.Instant.fromEpochMilliseconds(0),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
    passkeyNudgeDismissedAt: null,
  };
}

export function createAnnotationTestOrganizations(members: TestOrganizationMember[] = []) {
  return Object.assign(createApiFixture<OrganizationApi>(), {
    getOrganizationMembers: vi.fn(async ({ userIds }: { userIds: string[] }) => userIds),
    getAllMembers: vi.fn(async () => members.map(organizationMember)),
  });
}

export function createAnnotationTestTraces(): TraceApi {
  return createApiFixture<TraceApi>({
    findExistingTraceIds: async () => [],
    loadTraces: async () => [],
  });
}

export function createAnnotationTestUsers(): UserApi {
  return createApiFixture<UserApi>({ getProfiles: async () => [] });
}

export function createAnnotationTestAuthz(canUpdate = true): AuthzApi {
  return createApiFixture<AuthzApi>({ hasProjectPermission: async () => canUpdate });
}

const TIER_PLAN_TYPE = {
  free: "FREE",
  paid: "PRO",
  enterprise: "ENTERPRISE",
} as const;

/**
 * The entitlement peer answering every request bound on one tier. Suites that
 * assert clamp behavior pick the tier; the rest take the free default, the
 * same answer an absent entitlement resolves.
 */
export function createAnnotationTestEntitlement(
  tier: keyof typeof TIER_PLAN_TYPE = "free",
): EntitlementApi {
  return createApiFixture<EntitlementApi>({
    requestBound: ({ key }: { key: RequestBoundKey; organizationId: string }) =>
      Promise.resolve(resolveRequestBound(key, TIER_PLAN_TYPE[tier])),
  });
}

export function createAnnotationTestApp(
  input: Readonly<{
    repositories?: AnnotationRepositories;
    dependencies?: Partial<{
      projects: ProjectApi;
      organizations: OrganizationApi;
      traces: TraceApi;
      users: UserApi;
      permissions: AuthzApi;
      entitlement: EntitlementApi;
    }>;
  }> = {},
): AnnotationApp {
  return AnnotationApp.create({
    repositories: input.repositories ?? MemoryAnnotationRepositories.create(),
    dependencies: {
      projects: input.dependencies?.projects ?? createAnnotationTestProjects(),
      organizations: input.dependencies?.organizations ?? createAnnotationTestOrganizations(),
      traces: input.dependencies?.traces ?? createAnnotationTestTraces(),
      users: input.dependencies?.users ?? createAnnotationTestUsers(),
      permissions: input.dependencies?.permissions ?? createAnnotationTestAuthz(),
      entitlement: input.dependencies?.entitlement ?? createAnnotationTestEntitlement(),
    },
    config: undefined,
  });
}
