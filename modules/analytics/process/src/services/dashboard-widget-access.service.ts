import {
  CUSTOM_CHART_PLAYGROUND_FLAG,
  CustomChartPlaygroundNotEnabledError,
} from "@langwatch/analytics-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import { dashboardsEnabled, lwqlEnabled } from "../rules/lwql-access.rules.ts";

/**
 * Whether a project may use the dashboard widget surface: Dashboards and LangWatchQL both on.
 * The custom chart playground flag also opens it, for the legacy reports page's widget drawer.
 */
export class DashboardWidgetAccessService {
  #featureFlags: FeatureFlagApi;
  #projects: ProjectApi;

  private constructor(featureFlags: FeatureFlagApi, projects: ProjectApi) {
    this.#featureFlags = featureFlags;
    this.#projects = projects;
  }

  static create(input: {
    featureFlags: FeatureFlagApi;
    projects: ProjectApi;
  }): DashboardWidgetAccessService {
    return new DashboardWidgetAccessService(input.featureFlags, input.projects);
  }

  async assertEnabled({ projectId }: { projectId: string }): Promise<void> {
    if (await this.#isEnabled({ projectId })) return;
    throw new CustomChartPlaygroundNotEnabledError();
  }

  async #isEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    const gate = { featureFlags: this.#featureFlags, projectId, projects: this.#projects };
    const [dashboards, lwql, playground] = await Promise.all([
      dashboardsEnabled(gate),
      lwqlEnabled(gate),
      this.#isPlaygroundEnabled({ projectId }),
    ]);
    return (dashboards && lwql) || playground;
  }

  async #isPlaygroundEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    const organizationId = await this.#projects.findOrganizationId(projectId);
    return this.#featureFlags.isEnabled(CUSTOM_CHART_PLAYGROUND_FLAG, {
      kind: "project",
      projectId,
      ...(organizationId ? { organizationId } : {}),
    });
  }
}
