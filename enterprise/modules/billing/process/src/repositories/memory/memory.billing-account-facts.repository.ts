// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  OrganizationIdPage,
  OrganizationIdPageInput,
  OrganizationWithAdministrators,
} from "@langwatch/organization-contract";

import { BillingAccountFactsRepository } from "../billing-account-facts.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

/** The narrow organization reads the lifecycle services make, held in a map. */
export class MemoryBillingOrganizationRepository extends BillingAccountFactsRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingOrganizationRepository {
    return new MemoryBillingOrganizationRepository(store);
  }

  async findPricingModel(organizationId: string): Promise<string | null> {
    return this.store.organizations.get(organizationId)?.pricingModel ?? null;
  }

  async findStripeCustomerId(organizationId: string): Promise<string | null> {
    return this.store.organizations.get(organizationId)?.stripeCustomerId ?? null;
  }

  async findName(organizationId: string): Promise<{ id: string; name: string } | null> {
    const organization = this.store.organizations.get(organizationId);
    return organization ? { id: organization.id, name: organization.name } : null;
  }

  async findFirstTeamId(organizationId: string): Promise<string | null> {
    return this.store.organizations.get(organizationId)?.teamIds[0] ?? null;
  }

  async findBillingProfile(
    organizationId: string,
  ): Promise<{ name: string; stripeCustomerId: string | null } | null> {
    const organization = this.store.organizations.get(organizationId);
    return organization
      ? { name: organization.name, stripeCustomerId: organization.stripeCustomerId ?? null }
      : null;
  }

  async claimStripeCustomerId(input: {
    organizationId: string;
    stripeCustomerId: string;
  }): Promise<boolean> {
    const organization = this.store.organizations.get(input.organizationId);
    if (!organization || organization.stripeCustomerId) return false;
    organization.stripeCustomerId = input.stripeCustomerId;
    return true;
  }

  async findWithAdministrators(
    organizationId: string,
  ): Promise<OrganizationWithAdministrators | null> {
    const organization = this.store.organizations.get(organizationId);
    if (!organization) return null;
    return {
      id: organization.id,
      name: organization.name,
      sentPlanLimitAlert: organization.sentPlanLimitAlert ?? null,
      administrators: this.store.members
        .filter((member) => member.organizationId === organizationId && member.role === "ADMIN")
        .flatMap(({ userId }) => {
          const user = this.store.users.get(userId);
          return user ? [{ userId, name: user.name, email: user.email }] : [];
        }),
    };
  }

  async findActiveMemberIds(organizationId: string): Promise<string[]> {
    return this.store.members
      .filter(
        (member) =>
          member.organizationId === organizationId &&
          !member.disabled &&
          this.store.users.get(member.userId)?.deactivated === false,
      )
      .map((member) => member.userId);
  }

  async findSelfHostedCustomers(): Promise<{ organizationId: string; organizationName: string }[]> {
    return [...this.store.organizations.values()]
      .filter((organization) => organization.selfHostedCustomer)
      .map((organization) => ({
        organizationId: organization.id,
        organizationName: organization.name,
      }));
  }

  async listIds({ after, limit }: OrganizationIdPageInput = {}): Promise<OrganizationIdPage> {
    const ids = [...this.store.organizations.keys()]
      .toSorted()
      .filter((id) => after === undefined || id > after);
    if (limit === undefined || ids.length <= limit) return { ids, next: null };
    const page = ids.slice(0, limit);
    return { ids: page, next: page.at(-1) ?? null };
  }
}
