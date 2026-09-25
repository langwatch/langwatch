import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
  type GovernanceSetupState,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import type { GovernanceSetupStateRepository } from "../repositories/governance-setup-state.repository.ts";

const RECENT_ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

type SetupStateOptions = {
  repository: GovernanceSetupStateRepository;
  keys: Pick<GatewayApi, "findPersonalVirtualKeys">;
  routingPolicies: Pick<EnterpriseGatewayApi, "countRoutingPolicies">;
  projects: Pick<ProjectApi, "findInternal" | "countWithTraces">;
  traces: Pick<TraceApi, "hasTraceWithAttribute">;
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
    const { repository, keys, routingPolicies: policies, projects, traces, now } = this.options;
    const [counts, routingPolicies, personalKeys, governanceProject, projectsWithTraces] =
      await Promise.all([
        repository.counts(organizationId),
        policies.countRoutingPolicies({ organizationId }),
        keys.findPersonalVirtualKeys({ organizationId }),
        projects.findInternal({ organizationId, kind: PROJECT_KIND.INTERNAL_GOVERNANCE }),
        projects.countWithTraces({ organizationId }),
      ]);
    const hasRecentActivity = governanceProject
      ? await traces.hasTraceWithAttribute({
          projectId: governanceProject.id,
          sinceMs: now() - RECENT_ACTIVITY_WINDOW_MS,
          attribute: { key: GOVERNANCE_ATTR.ORIGIN_KIND, value: GOVERNANCE_ORIGIN_KIND_VALUE },
        })
      : false;
    const hasPersonalVKs = personalKeys.length > 0;
    const hasRoutingPolicies = routingPolicies > 0;
    const hasIngestionSources = counts.ingestionSources > 0;
    const hasAnomalyRules = counts.anomalyRules > 0;
    const hasApplicationTraces = projectsWithTraces > 0;

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
