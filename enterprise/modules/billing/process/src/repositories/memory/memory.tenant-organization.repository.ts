// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { TenantOrganizationRepository } from "../tenant-organization.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

/**
 * The attribution lookup, held in a map. An unattributed tenant answers null
 * rather than borrowing a neighbour's organization, as the Prisma twin does.
 */
export class MemoryBillingTenantOrganizationRepository extends TenantOrganizationRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingTenantOrganizationRepository {
    return new MemoryBillingTenantOrganizationRepository(store);
  }

  async findOrganizationForTenant(tenantId: string): Promise<string | null> {
    return this.store.organizationOfTenant.get(tenantId) ?? null;
  }
}
