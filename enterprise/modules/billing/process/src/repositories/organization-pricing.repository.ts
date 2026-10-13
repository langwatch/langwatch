export abstract class OrganizationPricingRepository {
  abstract findPricingModel(organizationId: string): Promise<string | null>;
}
