// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { OrganizationPricing } from "../organization/organization-pricing.repository.ts";
import type { MemoryBillingStore } from "./memory-billing.store.ts";

/**
 * The pricing-model read on its own, over the same store the account facts
 * answer from: a model written once is what both rows report.
 */
export class MemoryOrganizationPricingRepository extends OrganizationPricing {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryOrganizationPricingRepository {
    return new MemoryOrganizationPricingRepository(store);
  }

  async tryGetPricingModel(organizationId: string): Promise<string | null> {
    return this.store.organizations.get(organizationId)?.pricingModel ?? null;
  }
}
