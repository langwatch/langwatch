// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingOrganizationCache } from "../organization/billing-organization-cache.repository.ts";
import type { BillingReportOrganizationLookup } from "../organization/billing-report-organization.repository.ts";

/** The Redis read-through cache's twin: one map per install, no expiry. */
export class MemoryBillingOrganizationCacheRepository implements BillingOrganizationCache {
  static create(): MemoryBillingOrganizationCacheRepository {
    return new MemoryBillingOrganizationCacheRepository();
  }

  readonly #entries = new Map<string, BillingReportOrganizationLookup>();

  private constructor() {}

  async find(key: string): Promise<BillingReportOrganizationLookup | undefined> {
    return this.#entries.get(key);
  }

  async set(key: string, value: BillingReportOrganizationLookup): Promise<void> {
    this.#entries.set(key, value);
  }
}
