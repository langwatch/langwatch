// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { BillingWebhookOrganization } from "../billing-webhook-organization.repository.ts";
import type { MemoryBillingStore } from "./memory-billing.store.ts";

/**
 * The four organization reads and writes a Stripe webhook makes, over the same
 * store the account facts answer from: a currency written here is what a later
 * account read reports.
 */
export class MemoryBillingWebhookOrganizationRepository extends BillingWebhookOrganization {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingWebhookOrganizationRepository {
    return new MemoryBillingWebhookOrganizationRepository(store);
  }

  async tryFindByStripeCustomerId(stripeCustomerId: string): Promise<{ id: string } | null> {
    const found = [...this.store.organizations.values()].find(
      (organization) => organization.stripeCustomerId === stripeCustomerId,
    );
    return found ? { id: found.id } : null;
  }

  async tryFindNameById(organizationId: string): Promise<{ id: string; name: string } | null> {
    const organization = this.store.organizations.get(organizationId);
    return organization ? { id: organization.id, name: organization.name } : null;
  }

  async updateCurrency(input: { organizationId: string; currency: string }): Promise<void> {
    const organization = this.store.organizations.get(input.organizationId);
    if (organization) organization.currency = input.currency;
  }

  async clearTrialLicense(organizationId: string): Promise<void> {
    const organization = this.store.organizations.get(organizationId);
    if (organization) organization.license = null;
  }
}
