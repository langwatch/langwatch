import type {
  AnalyticsApi,
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { AutomationApi, Trigger } from "@langwatch/automation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { vi } from "vitest";

import type { DashboardRepositories } from "../../repositories/dashboard.repositories.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { DashboardApp } from "../dashboard.app.ts";
import type { DashboardAudience } from "../dashboard.members.ts";

/** Everything visible: the caller the gates are measured against. */
export const FULLY_PERMITTED: LangWatchQLProtections = {
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

export function createDashboardTestProjects(slug = "project-one"): ProjectApi {
  return createApiFixture<ProjectApi>({
    findSummaryById: async () => ({ name: "Project One", slug }),
    findById: async (id: string) => ({ id, teamId: TEST_TEAM_ID }) as Project,
    getOrganizationId: async () => TEST_ORGANIZATION_ID,
  });
}

/** `release_dashboards` for every project, on unless said otherwise. */
export function createDashboardTestFeatureFlags(dashboardsEnabled = true): FeatureFlagApi {
  return createApiFixture<FeatureFlagApi>({
    isEnabled: async (flagKey) => flagKey === "release_dashboards" && dashboardsEnabled,
  });
}

/** Admins hold `project:manage`; nobody else does. */
export function createDashboardTestAuthz(adminIds: readonly string[] = []): AuthzApi {
  return createApiFixture<AuthzApi>({
    hasPermission: async (check) =>
      check.permission === "project:manage" && adminIds.includes(check.userId),
  });
}

/** Members of the project's team; everyone else is only in the organisation. */
export function createDashboardTestOrganizations(
  teamMemberIds: readonly string[] = [],
): OrganizationApi {
  return createApiFixture<OrganizationApi>({
    findMemberTeamIds: async ({ userId }) => (teamMemberIds.includes(userId) ? [TEST_TEAM_ID] : []),
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
      featureFlags: FeatureFlagApi;
      authz: AuthzApi;
      organizations: OrganizationApi;
    }>;
  }> = {},
): DashboardApp {
  return DashboardApp.create({
    repositories: input.repositories ?? MemoryDashboardRepositories.create(),
    members: { publicBaseUrl: input.publicBaseUrl },
    dependencies: {
      analytics: input.dependencies?.analytics ?? createDashboardTestAnalytics(),
      automation: input.dependencies?.automation ?? createDashboardTestAutomation(),
      projects: input.dependencies?.projects ?? createDashboardTestProjects(),
      featureFlags: input.dependencies?.featureFlags ?? createDashboardTestFeatureFlags(),
      authz: input.dependencies?.authz ?? createDashboardTestAuthz(),
      organizations: input.dependencies?.organizations ?? createDashboardTestOrganizations(),
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: {} as never,
  });
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
