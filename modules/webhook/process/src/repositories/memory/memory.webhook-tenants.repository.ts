import { WebhookTenantsRepository } from "../webhook-tenants.repository.ts";

export class MemoryWebhookTenantsRepository extends WebhookTenantsRepository {
  static create(): MemoryWebhookTenantsRepository {
    return new MemoryWebhookTenantsRepository();
  }

  async tenantIdsForOrganization(organizationId: string): Promise<string[]> {
    return [organizationId];
  }
}
