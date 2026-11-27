import type {
  AnalyticsApi,
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import { EVERY_CATALOGUE_PERMISSION } from "@langwatch/analytics-process/testing";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { AutomationApi, Trigger } from "@langwatch/automation-contract";
import { ResourceScope } from "@langwatch/process";
import type { Project, ProjectApi, ProjectIdentity } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserFullProfile } from "@langwatch/user-contract";
import { vi } from "vitest";

import type { DashboardRepositories } from "../../repositories/dashboard.repositories.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { DashboardModule } from "../dashboard.app.ts";

/** Everything visible: the caller the gates are measured against. */
export const FULLY_PERMITTED: LangWatchQLProtections = {
  catalogue: EVERY_CATALOGUE_PERMISSION,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

export function createDashboardTestAnalytics(overrides: Partial<AnalyticsApi> = {}): AnalyticsApi {
  return createApiFixture<AnalyticsApi>({
    isLangWatchQLAvailable: () => true,
    describeLangWatchQLSchema: async () => ({
      database: "analytics",
      functions: [],
      views: [],
      appFunctions: [],
    }),
    validateLangWatchQL: (_input: LangWatchQLValidationInput) => ({
      parameters: [],
      appFunctions: [],
    }),
    executeLangWatchQL: async (
      _input: LangWatchQLExecuteInput,
    ): Promise<LangWatchQLQueryResult> => ({
      columns: [],
      rows: [],
      statistics: { elapsedMs: 0, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
      diagnostics: [],
      followsTimeWindow: false,
      followsGranularity: false,
    }),
    assertProjectsReadable: async () => void 0,
    isWorkbenchEnabled: async () => true,
    isDashboardsEnabled: async () => true,
    assertDashboardWidgetsEnabled: async () => void 0,
    resolveProtections: async () => FULLY_PERMITTED,
    resolveRunCaller: async () => ({
      project: { id: "project-1", lwqlKey: "restricted-project-key" },
      protections: FULLY_PERMITTED,
    }),
    ...overrides,
  });
}

export function createDashboardTestAutomation(triggers: Trigger[] = []): AutomationApi {
  return createApiFixture<AutomationApi>({
    getByCustomGraphIds: vi.fn(async () => triggers),
    findByCustomGraphId: vi.fn(async () => triggers[0] ?? null),
  });
}

/** Dashboards switched on for every project, for a service built without the analytics peer. */
export const DASHBOARDS_ROLLED_OUT = { isDashboardsEnabled: async () => true };

export const TEST_TEAM_ID = "team-1";
export const TEST_ORGANIZATION_ID = "organization-1";

/**
 * The project peer over a fixed directory. Every project sits in `TEST_ORGANIZATION_ID` unless
 * `organizations` names another for it, so a test can stand two projects in one organization
 * or in two.
 */
export function createDashboardTestProjects(
  input: Readonly<{
    slug?: string;
    organizations?: Readonly<Record<string, string>>;
    /** Personal projects, each by the user who owns it. */
    personalOwners?: Readonly<Record<string, string>>;
  }> = {},
): ProjectApi {
  const slug = input.slug ?? "project-one";
  const organizationOf = (projectId: string) =>
    input.organizations?.[projectId] ?? TEST_ORGANIZATION_ID;
  const identity = (id: string): ProjectIdentity => ({
    id,
    name: `Project ${id}`,
    slug: `slug-${id}`,
    teamId: TEST_TEAM_ID,
    organizationId: organizationOf(id),
    isPersonal: input.personalOwners?.[id] !== undefined,
    ownerUserId: input.personalOwners?.[id] ?? null,
    kind: "application",
  });
  return createApiFixture<ProjectApi>({
    findSummaryById: async () => ({ name: "Project One", slug }),
    findById: async (id: string) => ({ id, teamId: TEST_TEAM_ID }) as Project,
    getOrganizationId: async (projectId: string) => organizationOf(projectId),
    findOrganizationId: async (projectId: string) => organizationOf(projectId),
    listNamesByIds: async ({ projectIds }) => projectIds.map(identity),
    findLiveNonGovernanceIdsByOrganization: async ({ organizationId }) =>
      Object.keys(input.organizations ?? {}).filter((id) => organizationOf(id) === organizationId),
  });
}

/**
 * The authz peer: the projects named (every project by default) grant the permissions named
 * (every one by default), so a check answers for the permission it asks.
 */
export function createDashboardTestAuthz(
  input: Readonly<{ openProjectIds?: readonly string[]; permissions?: readonly string[] }> = {},
): AuthzApi {
  const opens = (projectId: string) =>
    input.openProjectIds === undefined || input.openProjectIds.includes(projectId);
  const grants = (permission: string) =>
    input.permissions === undefined || input.permissions.includes(permission);
  return createApiFixture<AuthzApi>({
    canBatchByIds: async ({ projects, permission }) => ({
      teams: new Map(),
      projects: new Map(
        projects.map(({ projectId }) => [projectId, opens(projectId) && grants(permission)]),
      ),
      organizationRole: null,
    }),
  });
}

/** Members by id, each answered with the name given; an id not given has no profile. */
export function createDashboardTestUsers(names: Readonly<Record<string, string | null>> = {}) {
  return createApiFixture<UserApi>({
    getProfiles: async ({ userIds }) =>
      userIds.flatMap((id): UserFullProfile[] =>
        id in names ? [testProfile({ id, name: names[id] ?? null })] : [],
      ),
  });
}

function testProfile({ id, name }: { id: string; name: string | null }): UserFullProfile {
  const at = new Date("2026-11-01");
  return {
    id,
    name,
    email: null,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  };
}

export function createDashboardTestApp(
  input: Readonly<{
    repositories?: DashboardRepositories;
    publicBaseUrl?: string;
    dependencies?: Partial<{
      analytics: AnalyticsApi;
      authz: AuthzApi;
      automation: AutomationApi;
      projects: ProjectApi;
      users: UserApi;
    }>;
  }> = {},
): DashboardModule {
  return DashboardModule.create({
    repositories: input.repositories ?? MemoryDashboardRepositories.create(),
    dependencies: {
      analytics: input.dependencies?.analytics ?? createDashboardTestAnalytics(),
      authz: input.dependencies?.authz ?? createDashboardTestAuthz(),
      automation: input.dependencies?.automation ?? createDashboardTestAutomation(),
      projects: input.dependencies?.projects ?? createDashboardTestProjects(),
      users: input.dependencies?.users ?? createDashboardTestUsers(),
    },
    config: { publicBaseUrl: input.publicBaseUrl },
    resources: new ResourceScope(),
    secrets: {} as never,
  });
}

/** Memory repositories holding one Dashboards board, for widgets placed on it. */
export async function createDashboardTestRepositoriesWithBoard(
  input: Readonly<{ projectId?: string; dashboardId?: string }> = {},
): Promise<DashboardRepositories> {
  const repositories = MemoryDashboardRepositories.create();
  await repositories.boards.createBoard({
    id: input.dashboardId ?? "dashboard-1",
    projectId: input.projectId ?? "project-1",
    name: "Board",
  });
  return repositories;
}
