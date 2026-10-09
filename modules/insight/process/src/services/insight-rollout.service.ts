import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { INSIGHTS_FLAG, InsightsNotEnabledError } from "@langwatch/insight-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The `release_insights` gate on the server. The browser flag only hides chrome; this is what
 * refuses, failing closed when the project names no organization.
 */
export class InsightRolloutService {
  private constructor(
    private readonly featureFlags: Pick<FeatureFlagApi, "isEnabled">,
    private readonly projects: Pick<ProjectApi, "getOrganizationId">,
  ) {}

  static create({
    featureFlags,
    projects,
  }: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    projects: Pick<ProjectApi, "getOrganizationId">;
  }): InsightRolloutService {
    return new InsightRolloutService(featureFlags, projects);
  }

  async assertEnabled({ projectId }: { projectId: string }): Promise<void> {
    const organizationId = await this.projects.getOrganizationId(projectId);
    const enabled = await this.featureFlags.isEnabled(INSIGHTS_FLAG, {
      kind: "project",
      projectId,
      organizationId,
    });
    if (!enabled) throw new InsightsNotEnabledError();
  }
}
