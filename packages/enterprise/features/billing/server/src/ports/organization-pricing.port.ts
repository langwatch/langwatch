export abstract class OrganizationPricingRepository {
  abstract getPricingModel(organizationId: string): Promise<string | null>;
}
