import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  INSIGHT_ACTIONS_FLAG,
  InsightActionsNotEnabledError,
  INSIGHTS_FLAG,
  InsightsNotEnabledError,
} from "@langwatch/insight-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The `release_insights` and `release_insight_actions` gates on the server. The browser flags
 * only hide chrome; this is what refuses, failing closed when the project names no organization.
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

  /** The action buttons ride on the inbox, so the inbox's gate is asked first. */
  async assertActionsEnabled(scope: { projectId: string }): Promise<void> {
    await this.assertEnabled(scope);
    if (!(await this.isFlagOn({ ...scope, flag: INSIGHT_ACTIONS_FLAG }))) {
      throw new InsightActionsNotEnabledError();
    }
  }

  /** For work nobody is waiting on, such as a run: it asks, and skips instead of refusing. */
  isEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    return this.isFlagOn({ projectId, flag: INSIGHTS_FLAG });
  }

  private async isFlagOn({
    projectId,
    flag,
  }: {
    projectId: string;
    flag: typeof INSIGHTS_FLAG | typeof INSIGHT_ACTIONS_FLAG;
  }): Promise<boolean> {
    const organizationId = await this.projects.getOrganizationId(projectId);
    return this.featureFlags.isEnabled(flag, { kind: "project", projectId, organizationId });
  }
}
