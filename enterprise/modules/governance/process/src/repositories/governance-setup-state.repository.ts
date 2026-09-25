export type GovernanceSetupCounts = {
  ingestionSources: number;
  anomalyRules: number;
};

export abstract class GovernanceSetupStateRepository {
  abstract counts(organizationId: string): Promise<GovernanceSetupCounts>;
}

/**
 * Single-method audit-read interface (OCSF export) — under the twenty-line
 * fragment-file floor on its own; `GovernanceOcsfEventsReader` covers the
 * larger reader.
 */
export abstract class GovernanceOcsfExportRepository {
  abstract findGovernanceTenantId(organizationId: string): Promise<string | null>;
}
