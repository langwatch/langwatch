import { DashboardGraphVisibilityPolicyPort } from "../ports/dashboard.port";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { lwqlEnabled } from "@langwatch/analytics-server";

/** Preserves the project-level LangWatchQL gate when Dashboard counts visible cards. */
export class WorkbenchAwareGraphVisibilityPolicy extends DashboardGraphVisibilityPolicyPort {
  private constructor(
    private readonly dependencies: {
      featureFlags: FeatureFlagService;
      projects: ProjectService;
    },
  ) {
    super();
  }

  static create(dependencies: {
    featureFlags: FeatureFlagService;
    projects: ProjectService;
  }): WorkbenchAwareGraphVisibilityPolicy {
    return new WorkbenchAwareGraphVisibilityPolicy(dependencies);
  }

  async placeableKinds(input: {
    projectId: string;
  }): Promise<readonly ("builder" | "workbench_sql")[]> {
    const enabled = await lwqlEnabled({
      featureFlags: this.dependencies.featureFlags,
      projectId: input.projectId,
      projects: this.dependencies.projects,
    });
    return enabled ? ["builder", "workbench_sql"] : ["builder"];
  }
}
