// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ErasedIdentifierSuppressionRow } from "../erased-identifier-suppression.repository.ts";
import type { GovernanceTenantRow } from "../governance-tenant-history.repository.ts";
import { SuppressionSnapshotRepository } from "../suppression-snapshot.repository.ts";
import type { MemoryDiscoveredPeopleStore } from "./memory.discovered-people.store.ts";

export class MemorySuppressionSnapshotRepository extends SuppressionSnapshotRepository {
  private constructor(private readonly store: MemoryDiscoveredPeopleStore) {
    super();
  }

  static create(store: MemoryDiscoveredPeopleStore): MemorySuppressionSnapshotRepository {
    return new MemorySuppressionSnapshotRepository(store);
  }

  async findAllSuppressions(): Promise<ErasedIdentifierSuppressionRow[]> {
    return this.store.suppressions.map((row) => ({ ...row }));
  }

  async findAllTenants(): Promise<GovernanceTenantRow[]> {
    return this.store.tenants.map(({ organizationId, tenantId }) => ({ organizationId, tenantId }));
  }
}
