import {
  CUSTOM_CHART_PLAYGROUND_FLAG,
  CustomGraphWritesDisabledForPlaygroundError,
} from "@langwatch/analytics-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

export class CustomChartPlaygroundAccessService {
  #featureFlags: FeatureFlagApi;
  #projects: ProjectApi;

  private constructor(featureFlags: FeatureFlagApi, projects: ProjectApi) {
    this.#featureFlags = featureFlags;
    this.#projects = projects;
  }

  static create(input: {
    featureFlags: FeatureFlagApi;
    projects: ProjectApi;
  }): CustomChartPlaygroundAccessService {
    return new CustomChartPlaygroundAccessService(input.featureFlags, input.projects);
  }

  async isEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    const organizationId = await this.#projects.findOrganizationId(projectId);
    return this.#featureFlags.isEnabled(CUSTOM_CHART_PLAYGROUND_FLAG, {
      kind: "project",
      projectId,
      ...(organizationId ? { organizationId } : {}),
    });
  }

  async assertCustomGraphWritesAllowed(input: { projectId: string }): Promise<void> {
    if (await this.isEnabled(input)) {
      throw new CustomGraphWritesDisabledForPlaygroundError();
    }
  }
}
