import type { TenantDirectory } from "@langwatch/clickhouse-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaTenantDirectoryRepository } from "../repositories/prisma/prisma.tenant-directory.repository.ts";
import {
  TenantDirectoryService,
  type TenantOwnershipReader,
} from "../services/tenant-directory.service.ts";

/**
 * The routing directory every process composes: this deployment's Postgres
 * behind the rule that places a tenant.
 */
export class PostgresTenantDirectoryAdapter implements TenantDirectory, TenantOwnershipReader {
  private readonly tenants = PrismaTenantDirectoryRepository.create();
  private readonly directory = TenantDirectoryService.create(this);

  private constructor(private readonly database: PrismaClient) {}

  static create(options: { database: PrismaClient }): PostgresTenantDirectoryAdapter {
    return new PostgresTenantDirectoryAdapter(options.database);
  }

  organizationForTenant(tenantId: string): Promise<string | null> {
    return this.directory.tryFindOrganizationForTenant(tenantId);
  }

  tryFindProjectOrganizationId(tenantId: string): Promise<string | null> {
    return this.tenants.tryFindProjectOrganizationId({ client: this.database, tenantId });
  }

  organizationExists(tenantId: string): Promise<boolean> {
    return this.tenants.organizationExists({ client: this.database, tenantId });
  }

  userExists(tenantId: string): Promise<boolean> {
    return this.tenants.userExists({ client: this.database, tenantId });
  }
}
