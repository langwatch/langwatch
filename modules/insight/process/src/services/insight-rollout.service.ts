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

  async assertEnabled(scope: { projectId: string }): Promise<void> {
    if (!(await this.isEnabled(scope))) throw new InsightsNotEnabledError();
  }

  /** For work nobody is waiting on, such as a run: it asks, and skips instead of refusing. */
  async isEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    const organizationId = await this.projects.getOrganizationId(projectId);
    return this.featureFlags.isEnabled(INSIGHTS_FLAG, {
      kind: "project",
      projectId,
      organizationId,
    });
  }
}
