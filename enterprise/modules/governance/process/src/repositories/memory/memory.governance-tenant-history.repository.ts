// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Temporal, type Instant } from "@langwatch/time";

import {
  GovernanceTenantHistoryRepository,
  type GovernanceTenantRow,
} from "../governance-tenant-history.repository.ts";
import type { MemoryDiscoveredPeopleStore } from "./memory.discovered-people.store.ts";

export class MemoryGovernanceTenantHistoryRepository extends GovernanceTenantHistoryRepository {
  private constructor(private readonly store: MemoryDiscoveredPeopleStore) {
    super();
  }

  static create(store: MemoryDiscoveredPeopleStore): MemoryGovernanceTenantHistoryRepository {
    return new MemoryGovernanceTenantHistoryRepository(store);
  }

  async findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GovernanceTenantRow[]> {
    return this.store.tenants
      .filter((row) => row.organizationId === organizationId)
      .toSorted((a, b) => Temporal.Instant.compare(a.firstUsedAt, b.firstUsedAt))
      .map(({ tenantId }) => ({ organizationId, tenantId }));
  }

  async findAll(): Promise<GovernanceTenantRow[]> {
    return this.store.tenants.map(({ organizationId, tenantId }) => ({ organizationId, tenantId }));
  }

  async touch(input: { organizationId: string; tenantId: string; at: Instant }): Promise<boolean> {
    const row = this.store.tenants.find(
      (tenant) =>
        tenant.organizationId === input.organizationId && tenant.tenantId === input.tenantId,
    );
    if (!row) return false;
    row.lastUsedAt = input.at;
    return true;
  }

  async append(input: { organizationId: string; tenantId: string; at: Instant }): Promise<void> {
    const exists = this.store.tenants.some(
      (tenant) =>
        tenant.organizationId === input.organizationId && tenant.tenantId === input.tenantId,
    );
    if (exists) return;
    this.store.tenants.push({
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      firstUsedAt: input.at,
      lastUsedAt: input.at,
    });
  }
}
