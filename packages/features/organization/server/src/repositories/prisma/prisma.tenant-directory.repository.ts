import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

export type TenantDirectoryClient = PrismaClient | Prisma.TransactionClient;

/**
 * The three id reads a routed ClickHouse client is placed by, through
 * whichever client the process already holds — so a project that moves
 * organizations routes to its new endpoint on the next resolution.
 */
export class PrismaTenantDirectoryRepository {
  static create(): PrismaTenantDirectoryRepository {
    return new PrismaTenantDirectoryRepository();
  }

  private constructor() {}

  async tryFindProjectOrganizationId({
    client,
    tenantId,
  }: {
    client: TenantDirectoryClient;
    tenantId: string;
  }): Promise<string | null> {
    const project = await client.project.findUnique({
      where: { id: tenantId },
      select: { team: { select: { organizationId: true } } },
    });

    return project?.team?.organizationId ?? null;
  }

  async organizationExists({
    client,
    tenantId,
  }: {
    client: TenantDirectoryClient;
    tenantId: string;
  }): Promise<boolean> {
    const organization = await client.organization.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    return organization !== null;
  }

  async userExists({
    client,
    tenantId,
  }: {
    client: TenantDirectoryClient;
    tenantId: string;
  }): Promise<boolean> {
    const user = await client.user.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    return user !== null;
  }
}
