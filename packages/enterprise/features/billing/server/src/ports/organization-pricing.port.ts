export abstract class OrganizationPricingPort {
  abstract tryGetPricingModel(organizationId: string): Promise<string | null>;
}
