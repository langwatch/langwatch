import type {
  AnalyticsApi,
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import type { AutomationApi, Trigger } from "@langwatch/automation-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import { AlertRedactionPort } from "../../ports/alert-redaction.port.ts";
import { PlatformUrlPort } from "../../ports/platform-url.port.ts";
import { WorkbenchAccessPort } from "../../ports/workbench-access.port.ts";
import { WorkbenchCallerPort } from "../../ports/workbench-caller.port.ts";
import type { DashboardRepositories } from "../../repositories/dashboard.repositories.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { DashboardApp, type DashboardInfrastructure } from "../dashboard.app.ts";

/** Everything visible: the caller the gates are measured against. */
export const FULLY_PERMITTED: LangWatchQLProtections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

/** The workbench switched on, and nothing else. */
export class TestWorkbenchAccess extends WorkbenchAccessPort {
  constructor(private readonly enabled = true) {
    super();
  }

  async isWorkbenchEnabled(): Promise<boolean> {
    return this.enabled;
  }
}

export class TestWorkbenchCaller extends WorkbenchCallerPort {
  constructor(private readonly protections: LangWatchQLProtections = FULLY_PERMITTED) {
    super();
  }

  async resolveProtections(): Promise<LangWatchQLProtections> {
    return this.protections;
  }

  async resolveRunCaller() {
    return {
      project: { id: "project-1", lwqlKey: "restricted-project-key" },
      protections: this.protections,
    };
  }
}

/** Drops one provider secret, the way the composed redaction drops several. */
export class TestAlertRedaction extends AlertRedactionPort {
  redactActionParams(
    _action: Trigger["action"],
    actionParams: Record<string, unknown>,
  ): Record<string, unknown> {
    const { slackWebhook: _dropped, ...visible } = actionParams;
    return visible;
  }
}

export class TestPlatformUrl extends PlatformUrlPort {
  linkTo(input: { projectSlug: string; path: string }): string {
    return `https://app.test/${input.projectSlug}${input.path}`;
  }
}

export function createDashboardTestAnalytics(overrides: Partial<AnalyticsApi> = {}): AnalyticsApi {
  return createApiFixture<AnalyticsApi>({
    isLangWatchQLAvailable: () => true,
    describeLangWatchQLSchema: () => ({ database: "analytics", datasets: [] }),
    validateLangWatchQL: (_input: LangWatchQLValidationInput) => undefined,
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
    ...overrides,
  });
}

export function createDashboardTestAutomation(triggers: Trigger[] = []): AutomationApi {
  return createApiFixture<AutomationApi>({
    getByCustomGraphIds: vi.fn(async () => triggers),
    tryGetByCustomGraphId: vi.fn(async () => triggers[0] ?? null),
  });
}

export function createDashboardTestProjects(slug = "project-one"): ProjectApi {
  return createApiFixture<ProjectApi>({
    tryGetSummaryById: async () => ({ name: "Project One", slug }),
  });
}

export function createDashboardTestInfrastructure(
  overrides: Partial<DashboardInfrastructure> = {},
): DashboardInfrastructure {
  return {
    workbenchAccess: new TestWorkbenchAccess(),
    workbenchCaller: new TestWorkbenchCaller(),
    alertRedaction: new TestAlertRedaction(),
    platformUrl: new TestPlatformUrl(),
    ...overrides,
  };
}

export function createDashboardTestApp(
  input: Readonly<{
    repositories?: DashboardRepositories;
    infrastructure?: Partial<DashboardInfrastructure>;
    dependencies?: Partial<{
      analytics: AnalyticsApi;
      automation: AutomationApi;
      projects: ProjectApi;
    }>;
  }> = {},
): DashboardApp {
  return DashboardApp.create({
    repositories: input.repositories ?? MemoryDashboardRepositories.create(),
    infrastructure: createDashboardTestInfrastructure(input.infrastructure ?? {}),
    dependencies: {
      analytics: input.dependencies?.analytics ?? createDashboardTestAnalytics(),
      automation: input.dependencies?.automation ?? createDashboardTestAutomation(),
      projects: input.dependencies?.projects ?? createDashboardTestProjects(),
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
