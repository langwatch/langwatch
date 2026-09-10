// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { BillingOrganization } from "../organization/billing-account-facts.repository.ts";
import type { MemoryBillingStore } from "./memory-billing.store.ts";

/** The narrow organization reads the lifecycle services make, held in a map. */
export class MemoryBillingOrganizationRepository extends BillingOrganization {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingOrganizationRepository {
    return new MemoryBillingOrganizationRepository(store);
  }

  async tryGetPricingModel(organizationId: string): Promise<string | null> {
    return this.store.organizations.get(organizationId)?.pricingModel ?? null;
  }

  async tryGetStripeCustomerId(organizationId: string): Promise<string | null> {
    return this.store.organizations.get(organizationId)?.stripeCustomerId ?? null;
  }

  async tryFindName(organizationId: string): Promise<{ id: string; name: string } | null> {
    const organization = this.store.organizations.get(organizationId);
    return organization ? { id: organization.id, name: organization.name } : null;
  }

  async tryFindFirstTeamId(organizationId: string): Promise<string | null> {
    return this.store.organizations.get(organizationId)?.teamIds[0] ?? null;
  }
}
