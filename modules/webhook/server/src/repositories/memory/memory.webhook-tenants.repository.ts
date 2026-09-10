import { WebhookTenantsRepository } from "../webhook-tenants.repository.ts";

/**
 * A memory-backed boot has no project table to resolve an organization's
 * ClickHouse tenant ids from, so it answers with the organization id itself.
 * Correct for a single-project boot (which is what a database-free test or
 * demo runs) and the reason the emitted-events log is exercised against
 * seeded rows rather than a real project directory in memory mode.
 */
export class MemoryWebhookTenantsRepository extends WebhookTenantsRepository {
  static create(): MemoryWebhookTenantsRepository {
    return new MemoryWebhookTenantsRepository();
  }

  async tenantIdsForOrganization(organizationId: string): Promise<string[]> {
    return [organizationId];
  }
}
