import type {
  AnalyticsApi,
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AutomationApi, Trigger } from "@langwatch/automation-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { ProjectApi } from "@langwatch/project-contract";
import { vi } from "vitest";

import type { DashboardRepositories } from "../../repositories/dashboard.repositories.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { DashboardApp } from "../dashboard.app.ts";

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
      datasets: [],
      appFunctions: [],
    }),
    validateLangWatchQL: (_input: LangWatchQLValidationInput) => ({
      parameters: [],
      appFunctions: [],
    }),
    executeLangWatchQL: async (_input: LangWatchQLExecuteInput) =>
      ({
        columns: [],
        rows: [],
        statistics: { elapsedMs: 0, rowsRead: 0, bytesRead: 0 },
        truncated: false,
        diagnostics: [],
        followsTimeWindow: false,
        followsGranularity: false,
      }) as unknown as LangWatchQLQueryResult,
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

export function createDashboardTestProjects(slug = "project-one"): ProjectApi {
  return createApiFixture<ProjectApi>({
    findSummaryById: async () => ({ name: "Project One", slug }),
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
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: {} as never,
  });
}
