// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceSetupStateRepository,
  type GovernanceSetupCounts,
} from "../governance-setup-state.repository.ts";

const NOTHING_SET_UP: GovernanceSetupCounts = {
  ingestionSources: 0,
  anomalyRules: 0,
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

  async counts(organizationId: string): Promise<GovernanceSetupCounts> {
    return this.byOrganization.get(organizationId) ?? NOTHING_SET_UP;
  }
}
