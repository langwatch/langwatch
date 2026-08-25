export abstract class OrganizationPricingRepository {
  abstract tryGetPricingModel(organizationId: string): Promise<string | null>;
}
