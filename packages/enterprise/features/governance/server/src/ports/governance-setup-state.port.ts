export type GovernanceSetupCounts = {
  personalVirtualKeys: number;
  routingPolicies: number;
  ingestionSources: number;
  anomalyRules: number;
  applicationProjectsWithTraces: number;
  governanceTenantId: string | null;
};

export abstract class GovernanceSetupStateRepository {
  abstract counts(organizationId: string): Promise<GovernanceSetupCounts>;
}

export abstract class GovernanceSetupActivityPort {
  abstract hasRecentActivity(input: {
    tenantId: string;
    sinceMs: number;
  }): Promise<boolean>;
}
