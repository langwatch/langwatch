export abstract class OrganizationPricing {
  abstract findPricingModel(organizationId: string): Promise<string | null>;
}
