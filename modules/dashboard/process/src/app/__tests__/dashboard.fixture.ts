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
    isWorkbenchEnabled: async () => true,
    isDashboardsEnabled: async () => true,
    assertCustomChartPlaygroundEnabled: async () => void 0,
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
  input: Readonly<{ slug?: string; organizations?: Readonly<Record<string, string>> }> = {},
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
    isPersonal: false,
    ownerUserId: null,
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

/** The authz peer, opening `analytics:view` on the projects named; on every project by default. */
export function createDashboardTestAuthz(
  input: Readonly<{ openProjectIds?: readonly string[] }> = {},
): AuthzApi {
  return createApiFixture<AuthzApi>({
    canBatchByIds: async ({ projects }) => ({
      teams: new Map(),
      projects: new Map(
        projects.map(({ projectId }) => [
          projectId,
          input.openProjectIds === undefined || input.openProjectIds.includes(projectId),
        ]),
      ),
      organizationRole: null,
    }),
  });
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
    },
    config: { publicBaseUrl: input.publicBaseUrl },
    resources: new ResourceScope(),
    secrets: {} as never,
  });
}

/** Memory repositories holding one board, for blocks placed on it. */
export async function createDashboardTestRepositoriesWithBoard(
  input: Readonly<{ projectId?: string; dashboardId?: string }> = {},
): Promise<DashboardRepositories> {
  const repositories = MemoryDashboardRepositories.create();
  await repositories.dashboards.createDashboard({
    id: input.dashboardId ?? "dashboard-1",
    projectId: input.projectId ?? "project-1",
    name: "Board",
    order: 0,
  });
  return repositories;
}
