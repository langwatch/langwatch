import type { BillingPricingModel } from "@langwatch/enterprise-billing-contract";

import type { OrganizationPricingRepository } from "../repositories/organization-pricing.repository.ts";

const PRICING_MODELS: readonly BillingPricingModel[] = ["TIERED", "SEAT_EVENT"];

function isPricingModel(value: string): value is BillingPricingModel {
  return PRICING_MODELS.some((model) => model === value);
}

/** The organization's pricing model, as main's `OrganizationRepository.getPricingModel` read it. */
export class OrganizationPricingService {
  static create(repository: OrganizationPricingRepository): OrganizationPricingService {
    return new OrganizationPricingService(repository);
  }

  private constructor(private readonly repository: OrganizationPricingRepository) {}

  async getPricingModel({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ pricingModel: BillingPricingModel | null }> {
    const value = await this.repository.findPricingModel(organizationId);

    return { pricingModel: value !== null && isPricingModel(value) ? value : null };
  }
}
