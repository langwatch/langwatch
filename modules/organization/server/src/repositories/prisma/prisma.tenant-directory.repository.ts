import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import type { TenantDirectory } from "@langwatch/clickhouse-client";
import { TenantDirectoryService, type TenantOwnershipReader } from "../../services/tenant-directory.service.ts";

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

/**
 * Binds this deployment's Postgres to the routing directory, for a process
 * that wants the {@link TenantDirectory} shape without booting the whole
 * organization module (the worker's tenancy lane). Replaces the deleted
 * `PostgresTenantDirectoryAdapter` class.
 */
export function bindTenantDirectoryReader(
  database: PrismaClient,
): TenantDirectory & TenantOwnershipReader {
  const tenants = PrismaTenantDirectoryRepository.create();
  const reader: TenantOwnershipReader = {
    tryFindProjectOrganizationId: (tenantId) =>
      tenants.tryFindProjectOrganizationId({ client: database, tenantId }),
    organizationExists: (tenantId) => tenants.organizationExists({ client: database, tenantId }),
    userExists: (tenantId) => tenants.userExists({ client: database, tenantId }),
  };
  const directory = TenantDirectoryService.create(reader);
  return {
    ...reader,
    organizationForTenant: (tenantId) => directory.tryFindOrganizationForTenant(tenantId),
  };
}
