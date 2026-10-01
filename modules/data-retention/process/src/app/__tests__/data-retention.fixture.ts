import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi, AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { ScopeAssignment } from "@langwatch/data-retention-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { OrganizationApi, OrganizationTeam } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi, ProjectWithTeam, Team } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { vi } from "vitest";

import type { DataRetentionRepositories } from "../../repositories/data-retention.repositories.ts";
import { MemoryDataRetentionRepositories } from "../../repositories/memory/memory.data-retention.repositories.ts";
import {
  DataRetentionApp,
  type DataRetentionDirectoryReader,
  type RetentionOrganizationDirectory,
  type RetentionProjectLineage,
} from "../data-retention.app.ts";

/** One organization with one team and one project, which is all a gate needs. */
export type RetentionTestDirectoryGraph = Readonly<{
  organizationId: string | null;
  organizationName: string;
  teamId: string;
  projectId: string;
  projectName: string;
}>;

export const retentionTestGraph: RetentionTestDirectoryGraph = {
  organizationId: "organization-1",
  organizationName: "Acme",
  teamId: "team-1",
  projectId: "project-1",
  projectName: "Checkout",
};

/** The lineage the gates read, over a single seeded graph. */
export class MemoryRetentionDirectory implements DataRetentionDirectoryReader {
  static create(graph: RetentionTestDirectoryGraph = retentionTestGraph): MemoryRetentionDirectory {
    return new MemoryRetentionDirectory(graph);
  }

  private constructor(private readonly graph: RetentionTestDirectoryGraph) {}

  async findProjectLineage({
    projectId,
  }: {
    projectId: string;
  }): Promise<RetentionProjectLineage | null> {
    if (projectId !== this.graph.projectId) return null;

    return {
      projectId,
      name: this.graph.projectName,
      teamId: this.graph.organizationId ? this.graph.teamId : null,
      organizationId: this.graph.organizationId,
      organizationName: this.graph.organizationId ? this.graph.organizationName : null,
    };
  }

  async findOrganizationDirectory(): Promise<RetentionOrganizationDirectory> {
    return {
      teams: [{ id: this.graph.teamId, name: "Payments" }],
      projects: [
        {
          id: this.graph.projectId,
          name: this.graph.projectName,
          teamId: this.graph.teamId,
          archived: false,
        },
      ],
    };
  }

  async findScopeOrganizationId({ scope }: { scope: ScopeAssignment }): Promise<string | null> {
    const { organizationId, teamId, projectId } = this.graph;
    if (scope.scopeType === "ORGANIZATION")
      return scope.scopeId === organizationId ? scope.scopeId : null;
    if (scope.scopeType === "TEAM") return scope.scopeId === teamId ? organizationId : null;

    return scope.scopeId === projectId ? organizationId : null;
  }

  async findScopeProjects(): Promise<readonly { id: string; teamId: string }[]> {
    return [{ id: this.graph.projectId, teamId: this.graph.teamId }];
  }
}

const epoch = new Date(0);

function testTeam(graph: RetentionTestDirectoryGraph): Team {
  return {
    id: graph.teamId,
    name: "Payments",
    slug: "payments",
    organizationId: graph.organizationId ?? "",
    createdAt: epoch,
    updatedAt: epoch,
    archivedAt: null,
    isPersonal: graph.organizationId === null,
    ownerUserId: null,
    departmentId: null,
  };
}

function testProject(graph: RetentionTestDirectoryGraph): ProjectWithTeam {
  return {
    id: graph.projectId,
    name: graph.projectName,
    slug: "checkout",
    apiKey: "key",
    lwqlKey: "lwql",
    teamId: graph.teamId,
    language: "typescript",
    framework: "other",
    kind: "default",
    firstMessage: false,
    integrated: false,
    createdAt: epoch,
    updatedAt: epoch,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: graph.organizationId === null,
    ownerUserId: null,
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: testTeam(graph),
  };
}

/**
 * `siblingProjectIds` are the other projects the organization holds, which is
 * what a cache invalidation on a wider scope has to reach.
 */
export function createDataRetentionTestProjects(
  graph: RetentionTestDirectoryGraph = retentionTestGraph,
  siblingProjectIds: readonly string[] = [],
): ProjectApi {
  const project = testProject(graph);
  const projects = [project, ...siblingProjectIds.map((id) => ({ ...project, id }))];

  return createApiFixture<ProjectApi>({
    findWithTeam: vi.fn(async (id: string) => (id === graph.projectId ? project : null)),
    listByTeam: vi.fn(async () => projects),
    listByOrganization: vi.fn(async () => ({
      data: projects,
      pagination: { page: 1, limit: projects.length, total: projects.length },
    })),
  });
}

export function createDataRetentionTestOrganizations(
  graph: RetentionTestDirectoryGraph = retentionTestGraph,
): OrganizationApi {
  const team: OrganizationTeam = {
    id: graph.teamId,
    name: "Payments",
    slug: "payments",
    organizationId: graph.organizationId ?? "",
    isPersonal: graph.organizationId === null,
    ownerUserId: null,
    archivedAt: null,
    createdAt: epoch,
    updatedAt: epoch,
  };

  return createApiFixture<OrganizationApi>({
    getTeamById: vi.fn(async () => team),
  });
}

/** Every permission answers `permitted`, so a gate test states one thing. */
export function createDataRetentionTestAuthz(permitted = true, platformOperator = false): AuthzApi {
  return createApiFixture<AuthzApi>({
    can: vi.fn(
      async ({ permission, scope }) =>
        platformOperator && permission === "ops:manage" && scope.type === "platform",
    ),
    hasPermission: vi.fn(async () => permitted),
    canBatchByIds: vi.fn(async (input: AuthzCanBatchByIdsInput) => ({
      teams: new Map(input.teams.map((team) => [team.teamId, permitted])),
      projects: new Map(input.projects.map((project) => [project.projectId, permitted])),
      organizationRole: null,
    })),
  });
}

export function createDataRetentionTestUsers(
  input: Readonly<{ email?: string | null }> = {},
): UserApi {
  const profile: UserProfile = {
    id: "user-1",
    name: null,
    email: input.email ?? null,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: epoch,
    updatedAt: epoch,
    lastLoginAt: null,
    deactivatedAt: null,
  };

  return createApiFixture<UserApi>({
    findById: vi.fn(async ({ id }: { id: string }) => ({ ...profile, id })),
  });
}

/** No statement this fixture issues ever reaches a server. */
function noopClickHouse(): ClickHouseQueryClient {
  return new ClickHouseQueryClient({
    driver: {
      execute: async () => ({ rows: [] }),
      insert: async () => {},
      command: async () => {},
    },
  });
}

/** The plan entitlement answers: an enterprise plan unless a test states otherwise. */
export function createDataRetentionTestEntitlement(
  plan: Readonly<{ free: boolean; type: string }> = { free: false, type: "ENTERPRISE" },
): EntitlementApi {
  return createApiFixture<EntitlementApi>({
    getActivePlan: vi.fn(async () => testPlan(plan)),
  });
}

function testPlan(plan: Readonly<{ free: boolean; type: string }>): Plan {
  return {
    planSource: plan.free ? "free" : "license",
    type: plan.type,
    name: plan.type,
    free: plan.free,
    maxMembers: 0,
    maxMembersLite: 0,
    maxMessagesPerMonth: 0,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };
}

type DataRetentionTestMembers = Readonly<{
  clickhouse: ClickHouseQueryClient;
  nodeEnvironment: string | undefined;
  redis: null;
}>;

export function createDataRetentionTestApp(
  input: Readonly<{
    repositories?: DataRetentionRepositories;
    directory?: DataRetentionDirectoryReader;
    clickhouse?: ClickHouseQueryClient;
    dependencies?: Partial<{
      projects: ProjectApi;
      organizations: OrganizationApi;
      permissions: AuthzApi;
      users: UserApi;
      entitlement: EntitlementApi;
    }>;
    platformDefaultRetentionDays?: number;
  }> = {},
): DataRetentionApp {
  const members: DataRetentionTestMembers = {
    clickhouse: input.clickhouse ?? noopClickHouse(),
    nodeEnvironment: "test",
    redis: null,
  };

  return DataRetentionApp.create({
    repositories: input.repositories ?? {
      ...MemoryDataRetentionRepositories.create(),
      directory: input.directory ?? MemoryRetentionDirectory.create(),
    },
    members,
    dependencies: {
      projects: input.dependencies?.projects ?? createDataRetentionTestProjects(),
      organizations: input.dependencies?.organizations ?? createDataRetentionTestOrganizations(),
      permissions: input.dependencies?.permissions ?? createDataRetentionTestAuthz(),
      users: input.dependencies?.users ?? createDataRetentionTestUsers(),
      entitlement: input.dependencies?.entitlement ?? createDataRetentionTestEntitlement(),
    },
    config: {
      platformDefaultDays: input.platformDefaultRetentionDays?.toString(),
      isSaas: true,
    },
    resources: new ResourceScope(),
    // No handle is ever resolved through it in these tests.
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}
