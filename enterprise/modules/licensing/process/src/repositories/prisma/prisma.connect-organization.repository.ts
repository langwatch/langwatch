import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, toDate } from "@langwatch/time";

import type {
  ConnectOrganizationRecord,
  ConnectOrganizationRepository,
} from "../connect-organization.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type ConnectOrganizationDatabase = Pick<PrismaClient, "organization">;

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

  async findLicensedOrganizationIds(): Promise<string[]> {
    const rows = await this.prisma.organization.findMany({
      where: { license: { not: null } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async setServicesDisabled({
    organizationId,
    servicesDisabled,
  }: {
    organizationId: string;
    servicesDisabled: readonly string[];
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { connectServicesDisabled: [...servicesDisabled] },
    });
  }

  async recordSyncOutcome({
    organizationId,
    at,
    error,
  }: {
    organizationId: string;
    at: Instant;
    error: string | null;
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: error
        ? { connectLastSyncError: error }
        : { connectLastSyncAt: toDate(at), connectLastSyncError: null },
    });
  }
}
