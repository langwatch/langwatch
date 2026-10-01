// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingTenantOrganizationCache } from "../../services/tenant-organization.service.ts";

/** The Redis tenant-attribution cache's twin: one map per install, no expiry. */
export class MemoryBillingTenantOrganizationCacheRepository implements BillingTenantOrganizationCache {
  static create(): MemoryBillingTenantOrganizationCacheRepository {
    return new MemoryBillingTenantOrganizationCacheRepository();
  }

  readonly #entries = new Map<string, string>();

  private constructor() {}

  async find(tenantId: string): Promise<string | undefined> {
    return this.#entries.get(tenantId);
  }

  async set(tenantId: string, organizationId: string): Promise<void> {
    this.#entries.set(tenantId, organizationId);
  }
}
