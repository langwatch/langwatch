import { CustomChartPlaygroundNotEnabledError } from "@langwatch/analytics-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import { dashboardsEnabled, lwqlEnabled } from "../rules/lwql-access.rules.ts";

/** Whether a project may use the dashboard widget surface: Dashboards and LangWatchQL both on. */
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
    const gate = { featureFlags: this.#featureFlags, projectId, projects: this.#projects };
    const [dashboards, lwql] = await Promise.all([dashboardsEnabled(gate), lwqlEnabled(gate)]);
    if (dashboards && lwql) return;
    throw new CustomChartPlaygroundNotEnabledError();
  }
}
