export type GovernanceSetupCounts = {
  ingestionSources: number;
  anomalyRules: number;
};

export abstract class GovernanceSetupStateRepository {
  abstract counts(organizationId: string): Promise<GovernanceSetupCounts>;
}
