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
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import type { DashboardRepositories } from "../../repositories/dashboard.repositories.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { DashboardModule } from "../dashboard.app.ts";
import type { DashboardAudience } from "../dashboard.members.ts";

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

export const TEST_TEAM_ID = "team-1";
export const TEST_ORGANIZATION_ID = "organization-1";

/** Team members are the listed ids; everyone else is outside the project's team. */
export function createDashboardTestProjects(
  input: Readonly<{ slug?: string; teamMemberIds?: readonly string[] }> = {},
): ProjectApi {
  const slug = input.slug ?? "project-one";
  const teamMemberIds = input.teamMemberIds ?? [];
  return createApiFixture<ProjectApi>({
    findSummaryById: async () => ({ name: "Project One", slug }),
    findById: async (id: string) => ({ id, teamId: TEST_TEAM_ID }) as Project,
    getOrganizationId: async () => TEST_ORGANIZATION_ID,
    isTeamMember: async ({ userId }) => teamMemberIds.includes(userId),
  });
}

/** Admins hold `project:manage`; nobody else does. */
export function createDashboardTestAuthz(adminIds: readonly string[] = []): AuthzApi {
  return createApiFixture<AuthzApi>({
    hasPermission: async (check) =>
      check.permission === "project:manage" && adminIds.includes(check.userId),
  });
}

export function createDashboardTestApp(
  input: Readonly<{
    repositories?: DashboardRepositories;
    publicBaseUrl?: string;
    dependencies?: Partial<{
      analytics: AnalyticsApi;
      automation: AutomationApi;
      projects: ProjectApi;
      authz: AuthzApi;
    }>;
  }> = {},
): DashboardModule {
  return DashboardModule.create({
    repositories: input.repositories ?? MemoryDashboardRepositories.create(),
    members: { publicBaseUrl: input.publicBaseUrl },
    dependencies: {
      analytics: input.dependencies?.analytics ?? createDashboardTestAnalytics(),
      automation: input.dependencies?.automation ?? createDashboardTestAutomation(),
      projects: input.dependencies?.projects ?? createDashboardTestProjects(),
      authz: input.dependencies?.authz ?? createDashboardTestAuthz(),
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: {} as never,
  });
}

/** Memory repositories holding one organisation-wide board, for blocks placed on it. */
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

/** An audience answered from two fixed lists, for driving the service directly. */
export class FixedDashboardAudience implements DashboardAudience {
  constructor(
    private readonly members: Readonly<{
      teamMemberIds?: readonly string[];
      adminIds?: readonly string[];
    }> = {},
  ) {}

  async isTeamMember(input: { userId: string }): Promise<boolean> {
    return (this.members.teamMemberIds ?? []).includes(input.userId);
  }

  async isAdmin(input: { userId: string }): Promise<boolean> {
    return (this.members.adminIds ?? []).includes(input.userId);
  }
}
