import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { WebhookTenantsRepository } from "../webhook-tenants.repository.ts";

/** Only what this repository reads: a project is the ClickHouse TenantId,
 *  and an organization owns many of them through its teams. */
export type WebhookTenantsDatabase = Pick<PrismaClient, "project">;

export class PrismaWebhookTenantsRepository extends WebhookTenantsRepository {
  private constructor(private readonly prisma: WebhookTenantsDatabase) {
    super();
  }

  static create(prisma: WebhookTenantsDatabase): PrismaWebhookTenantsRepository {
    return new PrismaWebhookTenantsRepository(prisma);
  }

  async tenantIdsForOrganization(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    return rows.map((row) => row.id);
  }
}
