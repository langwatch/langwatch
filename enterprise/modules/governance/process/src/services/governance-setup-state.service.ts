import { type GovernanceSetupState } from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";

import type { GovernanceSetupActivityReader } from "../app/governance.members.ts";
import type { GovernanceSetupStateRepository } from "../repositories/governance-setup-state.repository.ts";

const RECENT_ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

type SetupStateOptions = {
  repository: GovernanceSetupStateRepository;
  keys: Pick<GatewayApi, "findPersonalVirtualKeys">;
  projects: Pick<ProjectApi, "findInternal">;
  activity?: GovernanceSetupActivityReader;
  now: () => number;
};

export class DefaultGovernanceSetupStateService {
  private constructor(private readonly options: SetupStateOptions) {}

  static create(
    options: Omit<SetupStateOptions, "now"> & { now?: () => number },
  ): DefaultGovernanceSetupStateService {
    return new DefaultGovernanceSetupStateService({ ...options, now: options.now ?? Date.now });
  }

  async resolve(organizationId: string): Promise<GovernanceSetupState> {
    const { repository, keys, projects, activity, now } = this.options;
    const [counts, personalKeys, governanceProject] = await Promise.all([
      repository.counts(organizationId),
      keys.findPersonalVirtualKeys({ organizationId }),
      projects.findInternal({ organizationId, kind: PROJECT_KIND.INTERNAL_GOVERNANCE }),
    ]);
    const hasRecentActivity =
      governanceProject && activity
        ? await activity.hasRecentActivity({
            tenantId: governanceProject.id,
            sinceMs: now() - RECENT_ACTIVITY_WINDOW_MS,
          })
        : false;
    const hasPersonalVKs = personalKeys.length > 0;
    const hasRoutingPolicies = counts.routingPolicies > 0;
    const hasIngestionSources = counts.ingestionSources > 0;
    const hasAnomalyRules = counts.anomalyRules > 0;
    const hasApplicationTraces = counts.applicationProjectsWithTraces > 0;

    return {
      hasPersonalVKs,
      hasRoutingPolicies,
      hasIngestionSources,
      hasAnomalyRules,
      hasRecentActivity,
      hasApplicationTraces,
      governanceActive:
        hasPersonalVKs ||
        hasRoutingPolicies ||
        hasIngestionSources ||
        hasAnomalyRules ||
        hasRecentActivity,
    };
  }
}
