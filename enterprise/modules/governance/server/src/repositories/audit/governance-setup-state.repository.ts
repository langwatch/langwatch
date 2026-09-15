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

/**
 * Folded in from the now-deleted ocsf-export.repository.ts: both are single
 * one-method audit-read interfaces, and neither cleared the twenty-line
 * fragment- floor once the OCSF export service kept its own reader,
 * GovernanceOcsfEventsReader, on the module Infrastructure.
 */
export abstract class GovernanceOcsfExportRepository {
  abstract findGovernanceTenantId(organizationId: string): Promise<string | null>;
}
