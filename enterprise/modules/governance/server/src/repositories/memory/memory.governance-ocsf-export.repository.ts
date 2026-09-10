// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceOcsfExportRepository } from "../../ports/ocsf-export.port.ts";
import type { MemoryGovernanceStore } from "./memory-governance.store.ts";

/**
 * The OCSF export twin: the one read it owns is which hidden governance
 * project an organization's usage rows land in, which the shared store holds.
 */
export class MemoryGovernanceOcsfExportRepository extends GovernanceOcsfExportRepository {
  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemoryGovernanceOcsfExportRepository {
    return new MemoryGovernanceOcsfExportRepository(store);
  }

  async tryResolveGovernanceTenantId(organizationId: string): Promise<string | null> {
    return this.store.governanceTenantIds.get(organizationId) ?? null;
  }
}
