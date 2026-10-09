import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

import type {
  ConnectOrganizationRecord,
  ConnectOrganizationRepository,
  OrganizationCustomerRecord,
} from "../connect-organization.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
type ConnectOrganizationDatabase = Pick<PrismaClient, "organization">;

export class PrismaConnectOrganizationRepository implements ConnectOrganizationRepository {
  static create(database: ConnectOrganizationDatabase): PrismaConnectOrganizationRepository {
    return new PrismaConnectOrganizationRepository(database);
  }

  private constructor(private readonly prisma: ConnectOrganizationDatabase) {}

  async findById(organizationId: string): Promise<ConnectOrganizationRecord | null> {
    const row = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        license: true,
        connectServicesDisabled: true,
        connectLastSyncAt: true,
        connectLastSyncError: true,
      },
    });
    if (row === null) return null;
    return {
      organizationId,
      license: row.license,
      servicesDisabled: row.connectServicesDisabled,
      lastSyncAt: row.connectLastSyncAt === null ? null : fromDate(row.connectLastSyncAt),
      lastSyncError: row.connectLastSyncError,
    };
  }

  findCustomer(organizationId: string): Promise<OrganizationCustomerRecord | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });
  }

  async findLicensedOrganizationIds(): Promise<string[]> {
    const rows = await this.prisma.organization.findMany({
      where: { license: { not: null } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findAllOldestFirst(): Promise<{ organizationId: string; license: string | null }[]> {
    const rows = await this.prisma.organization.findMany({
      select: { id: true, license: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ organizationId: row.id, license: row.license }));
  }
}
