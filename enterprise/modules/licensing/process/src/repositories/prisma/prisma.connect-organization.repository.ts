import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

import { newerLicense } from "../../rules/license-columns.rules.ts";
import type {
  ConnectOrganizationRecord,
  ConnectOrganizationRepository,
  OrganizationCustomerRecord,
} from "../connect-organization.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client. The licence is licensing's own row;
 * organization's column is read only as the fallback while dual writes last (round 37 D6).
 */
type ConnectOrganizationDatabase = Pick<PrismaClient, "organization" | "organizationLicense">;

type DatedColumn = { license: string | null; updatedAt: Date };
type DatedRow = { licenseKey: string | null; updatedAt: Date };

const licenseOf = ({ organization, own }: { organization: DatedColumn; own: DatedRow | null }) =>
  newerLicense({
    columns: { licenseKey: organization.license, updatedAt: fromDate(organization.updatedAt) },
    own: own && { licenseKey: own.licenseKey, updatedAt: fromDate(own.updatedAt) },
  }).licenseKey;

const DATED_ROW = { organizationId: true, licenseKey: true, updatedAt: true } as const;

export class PrismaConnectOrganizationRepository implements ConnectOrganizationRepository {
  static create(database: ConnectOrganizationDatabase): PrismaConnectOrganizationRepository {
    return new PrismaConnectOrganizationRepository(database);
  }

  private constructor(private readonly prisma: ConnectOrganizationDatabase) {}

  async findById(organizationId: string): Promise<ConnectOrganizationRecord | null> {
    const [row, own] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          license: true,
          updatedAt: true,
          connectServicesDisabled: true,
          connectLastSyncAt: true,
          connectLastSyncError: true,
        },
      }),
      this.prisma.organizationLicense.findUnique({
        where: { organizationId },
        select: DATED_ROW,
      }),
    ]);
    if (row === null) return null;
    return {
      organizationId,
      license: licenseOf({ organization: row, own }),
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
    const own = await this.ownRows();
    const keyed = own.flatMap((row) => (row.licenseKey === null ? [] : [row.organizationId]));
    const organizations = await this.prisma.organization.findMany({
      where: { OR: [{ license: { not: null } }, { id: { in: keyed } }] },
      select: { id: true, license: true, updatedAt: true },
    });
    const rows = new Map(own.map((row) => [row.organizationId, row]));
    return organizations.flatMap((organization) =>
      licenseOf({ organization, own: rows.get(organization.id) ?? null }) === null
        ? []
        : [organization.id],
    );
  }

  async findAllOldestFirst(): Promise<{ organizationId: string; license: string | null }[]> {
    const [organizations, own] = await Promise.all([
      this.prisma.organization.findMany({
        select: { id: true, license: true, updatedAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.ownRows(),
    ]);
    const rows = new Map(own.map((row) => [row.organizationId, row]));
    return organizations.map((organization) => ({
      organizationId: organization.id,
      license: licenseOf({ organization, own: rows.get(organization.id) ?? null }),
    }));
  }

  private ownRows() {
    return this.prisma.organizationLicense.findMany({ select: DATED_ROW });
  }
}
