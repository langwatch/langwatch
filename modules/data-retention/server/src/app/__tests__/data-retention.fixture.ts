import type { AuthzApi, AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import type { ScopeAssignment } from "@langwatch/data-retention-contract";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "@langwatch/data-retention-contract";
import type { OrganizationApi, OrganizationTeam } from "@langwatch/organization-contract";
import type { ProjectApi, ProjectWithTeam, Team } from "@langwatch/project-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { vi } from "vitest";
import {
  DataRetentionDirectoryPort,
  type RetentionOrganizationDirectory,
  type RetentionProjectLineage,
} from "../../ports/data-retention-directory.port.ts";
import {
  DataRetentionPlanPort,
  type DataRetentionPlan,
} from "../../ports/data-retention-plan.port.ts";
import type { DataRetentionRepositories } from "../../repositories/data-retention.repositories.ts";
import { MemoryDataRetentionRepositories } from "../../repositories/memory/memory.data-retention.repositories.ts";
import { DataRetentionApp, type DataRetentionInfrastructure } from "../data-retention.app.ts";

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
export class MemoryRetentionDirectory extends DataRetentionDirectoryPort {
  static create(graph: RetentionTestDirectoryGraph = retentionTestGraph): MemoryRetentionDirectory {
    return new MemoryRetentionDirectory(graph);
  }

  private constructor(private readonly graph: RetentionTestDirectoryGraph) {
    super();
  }

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

  async listOrganizationDirectory(): Promise<RetentionOrganizationDirectory> {
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

  async listScopeProjects(): Promise<ReadonlyArray<{ id: string; teamId: string }>> {
    return [{ id: this.graph.projectId, teamId: this.graph.teamId }];
  }
}

/** The plan every gate is decided against, stated rather than billed for. */
export class MemoryRetentionPlans extends DataRetentionPlanPort {
  static create(plan: DataRetentionPlan = { free: false, uncapped: true }): MemoryRetentionPlans {
    return new MemoryRetentionPlans(plan);
  }

  private constructor(private readonly plan: DataRetentionPlan) {
    super();
  }

  async getPlan(): Promise<DataRetentionPlan> {
    return this.plan;
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
    tryGetWithTeam: vi.fn(async (id: string) => (id === graph.projectId ? project : null)),
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
export function createDataRetentionTestAuthz(permitted = true): AuthzApi {
  return createApiFixture<AuthzApi>({
    hasPermission: vi.fn(async () => permitted),
    canBatchByIds: vi.fn(async (input: AuthzCanBatchByIdsInput) => ({
      teams: new Map(input.teams.map((team) => [team.teamId, permitted])),
      projects: new Map(input.projects.map((project) => [project.projectId, permitted])),
      organizationRole: null,
    })),
  });
}

export function createDataRetentionTestUsers(
  input: Readonly<{ email?: string | null; platformAdministrator?: boolean }> = {},
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
    tryFindById: vi.fn(async ({ id }: { id: string }) => ({ ...profile, id })),
    isAdmin: vi.fn(() => input.platformAdministrator === true),
  });
}

export function createDataRetentionTestInfrastructure(
  overrides: Partial<DataRetentionInfrastructure> = {},
): DataRetentionInfrastructure {
  return {
    directory: overrides.directory ?? MemoryRetentionDirectory.create(),
    plans: overrides.plans ?? MemoryRetentionPlans.create(),
    redis: overrides.redis ?? null,
    resolveClickHouseClient: overrides.resolveClickHouseClient ?? null,
  };
}

export function createDataRetentionTestApp(
  input: Readonly<{
    repositories?: DataRetentionRepositories;
    infrastructure?: Partial<DataRetentionInfrastructure>;
    dependencies?: Partial<{
      projects: ProjectApi;
      organizations: OrganizationApi;
      permissions: AuthzApi;
      users: UserApi;
    }>;
    platformDefaultRetentionDays?: number;
  }> = {},
): DataRetentionApp {
  return DataRetentionApp.create({
    repositories: input.repositories ?? MemoryDataRetentionRepositories.create(),
    infrastructure: createDataRetentionTestInfrastructure(input.infrastructure ?? {}),
    dependencies: {
      projects: input.dependencies?.projects ?? createDataRetentionTestProjects(),
      organizations: input.dependencies?.organizations ?? createDataRetentionTestOrganizations(),
      permissions: input.dependencies?.permissions ?? createDataRetentionTestAuthz(),
      users: input.dependencies?.users ?? createDataRetentionTestUsers(),
    },
    config: {
      platformDefaultRetentionDays:
        input.platformDefaultRetentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    },
    resources: new ResourceScope(),
  });
}
