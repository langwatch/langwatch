export abstract class WebhookTenantsRepository {
  abstract tenantIdsForOrganization(organizationId: string): Promise<string[]>;
}
