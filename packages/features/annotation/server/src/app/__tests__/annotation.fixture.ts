import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi, User } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";
import { AnnotationApp } from "../annotation.app.ts";
import type { AnnotationRepositories } from "../../repositories/annotation.repositories.ts";
import { MemoryAnnotationRepositories } from "../../repositories/memory/memory.annotation.repositories.ts";

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
    createdAt: new Date(0),
    updatedAt: new Date(0),
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

export function createAnnotationTestApp(
  input: Readonly<{
    repositories?: AnnotationRepositories;
    dependencies?: Partial<{
      projects: ProjectApi;
      organizations: OrganizationApi;
      traces: TraceApi;
      users: UserApi;
      permissions: AuthzApi;
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
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
