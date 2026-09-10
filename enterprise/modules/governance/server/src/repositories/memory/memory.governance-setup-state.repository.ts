// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceSetupStateRepository,
  type GovernanceSetupCounts,
} from "../../ports/governance-setup-state.port.ts";

const NOTHING_SET_UP: GovernanceSetupCounts = {
  personalVirtualKeys: 0,
  routingPolicies: 0,
  ingestionSources: 0,
  anomalyRules: 0,
  applicationProjectsWithTraces: 0,
  governanceTenantId: null,
};

/**
 * The setup-state twin. An organization nobody has recorded counts for reads
 * as a fresh one, which is what the checklist shows before any step is taken.
 */
export class MemoryGovernanceSetupStateRepository extends GovernanceSetupStateRepository {
  private readonly byOrganization = new Map<string, GovernanceSetupCounts>();

  static create(): MemoryGovernanceSetupStateRepository {
    return new MemoryGovernanceSetupStateRepository();
  }

  record(organizationId: string, counts: GovernanceSetupCounts): void {
    this.byOrganization.set(organizationId, counts);
  }

  async counts(organizationId: string): Promise<GovernanceSetupCounts> {
    return this.byOrganization.get(organizationId) ?? NOTHING_SET_UP;
  }
}
