import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { WebhookTenantsRepository } from "../webhook-tenants.repository.ts";

export class PrismaWebhookTenantsRepository extends WebhookTenantsRepository {
  private constructor(private readonly client: PrismaClient) {
    super();
  }

  static create(client: PrismaClient): PrismaWebhookTenantsRepository {
    return new PrismaWebhookTenantsRepository(client);
  }

  async tenantIdsForOrganization(organizationId: string): Promise<string[]> {
    const projects = await this.client.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return projects.map((project) => project.id);
  }
}
