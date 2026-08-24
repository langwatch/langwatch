import type { GovernanceSetupState } from "@langwatch/enterprise-governance-contract";
import type {
  GovernanceSetupActivityPort,
  GovernanceSetupStateRepository,
} from "../ports/governance-setup-state.port";

const RECENT_ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

export class GovernanceSetupStateService {
  private constructor(
    private readonly repository: GovernanceSetupStateRepository,
    private readonly activity: GovernanceSetupActivityPort | undefined,
    private readonly now: () => number,
  ) {}

  static create(options: {
    repository: GovernanceSetupStateRepository;
    activity?: GovernanceSetupActivityPort;
    now?: () => number;
  }): GovernanceSetupStateService {
    return new GovernanceSetupStateService(
      options.repository,
      options.activity,
      options.now ?? Date.now,
    );
  }

  async resolve(organizationId: string): Promise<GovernanceSetupState> {
    const counts = await this.repository.counts(organizationId);
    const hasRecentActivity =
      counts.governanceTenantId && this.activity
        ? await this.activity.hasRecentActivity({
            tenantId: counts.governanceTenantId,
            sinceMs: this.now() - RECENT_ACTIVITY_WINDOW_MS,
          })
        : false;
    const hasPersonalVKs = counts.personalVirtualKeys > 0;
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
