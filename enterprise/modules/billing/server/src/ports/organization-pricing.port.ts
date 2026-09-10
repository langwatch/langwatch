export abstract class OrganizationPricing {
  abstract tryGetPricingModel(organizationId: string): Promise<string | null>;
}
