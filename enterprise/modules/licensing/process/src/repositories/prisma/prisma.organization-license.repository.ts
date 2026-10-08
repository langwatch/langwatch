import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import type {
  LicenseColumns,
  OrganizationLicenseCandidate,
  OrganizationLicensePair,
  OrganizationLicenseRepository,
  StoredLicense,
} from "../organization-license.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client. `organization` is the copy source
 * until its licence columns retire (round 37 D6).
 */
type OrganizationLicenseDatabase = Pick<PrismaClient, "organization" | "organizationLicense">;

const instantOrNull = (date: Date | null) => (date === null ? null : fromDate(date));
const dateOrNull = (instant: Instant | null) => (instant === null ? null : toDate(instant));

const CLEARED = { licenseKey: null, expiresAt: null, validatedAt: null } as const;

type LicenseRow = { licenseKey: string | null; expiresAt: Date | null; validatedAt: Date | null };

const licenseOf = (row: LicenseRow): LicenseColumns => ({
  licenseKey: row.licenseKey,
  expiresAt: instantOrNull(row.expiresAt),
  validatedAt: instantOrNull(row.validatedAt),
});

const rowOf = (license: LicenseColumns): LicenseRow => ({
  licenseKey: license.licenseKey,
  expiresAt: dateOrNull(license.expiresAt),
  validatedAt: dateOrNull(license.validatedAt),
});

/** Licensing's licence rows, falling back to organization's columns for a row not yet copied. */
export class PrismaOrganizationLicenseRepository implements OrganizationLicenseRepository {
  static readonly tables = prismaTables("OrganizationLicense");

  static create(database: OrganizationLicenseDatabase): PrismaOrganizationLicenseRepository {
    return new PrismaOrganizationLicenseRepository(database);
  }

  private constructor(private readonly prisma: OrganizationLicenseDatabase) {}

  async getOrganizationLicense(organizationId: string): Promise<{ licenseKey: string | null }> {
    const own = await this.prisma.organizationLicense.findUnique({
      where: { organizationId },
      select: { licenseKey: true },
    });
    if (own !== null) return { licenseKey: own.licenseKey };
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { license: true },
    });
    if (organization === null) throw new OrganizationNotFoundError();
    return { licenseKey: organization.license };
  }

  // Organization carries no archive column today; when one is added, exclude it
  // here so an archived organization cannot keep an installation licensed.
  async findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]> {
    const [own, organizations] = await Promise.all([
      this.prisma.organizationLicense.findMany({
        select: { organizationId: true, licenseKey: true },
      }),
      this.prisma.organization.findMany({
        where: { license: { not: null } },
        select: { id: true, license: true },
      }),
    ]);
    const held = new Set(own.map((row) => row.organizationId));
    return [
      ...own.flatMap((row) =>
        row.licenseKey === null
          ? []
          : [{ organizationId: row.organizationId, licenseKey: row.licenseKey }],
      ),
      ...organizations.flatMap((organization) =>
        organization.license === null || held.has(organization.id)
          ? []
          : [{ organizationId: organization.id, licenseKey: organization.license }],
      ),
    ];
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    return organization !== null;
  }

  async saveLicense({
    organizationId,
    license,
  }: Readonly<{ organizationId: string; license: StoredLicense }>): Promise<void> {
    await this.prisma.organizationLicense.upsert({
      where: { organizationId },
      create: { organizationId, ...rowOf(license) },
      update: rowOf(license),
    });
  }

  async clearLicense({ organizationId }: Readonly<{ organizationId: string }>): Promise<void> {
    await this.prisma.organizationLicense.upsert({
      where: { organizationId },
      create: { organizationId, ...CLEARED },
      update: CLEARED,
    });
  }

  async findLicensePairs({
    afterOrganizationId,
    limit,
  }: Readonly<{ afterOrganizationId: string | null; limit: number }>): Promise<
    OrganizationLicensePair[]
  > {
    const page = await this.prisma.organization.findMany({
      where: afterOrganizationId === null ? {} : { id: { gt: afterOrganizationId } },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true, license: true, licenseExpiresAt: true, licenseLastValidatedAt: true },
    });
    const held = await this.prisma.organizationLicense.findMany({
      where: { organizationId: { in: page.map((organization) => organization.id) } },
      select: { organizationId: true, licenseKey: true, expiresAt: true, validatedAt: true },
    });
    const own = new Map(held.map((row) => [row.organizationId, licenseOf(row)]));
    return page.map((organization) => ({
      organizationId: organization.id,
      columns: licenseOf({
        licenseKey: organization.license,
        expiresAt: organization.licenseExpiresAt,
        validatedAt: organization.licenseLastValidatedAt,
      }),
      own: own.get(organization.id) ?? null,
    }));
  }

  async overwriteLicenses({
    pairs,
  }: Readonly<{ pairs: readonly OrganizationLicensePair[] }>): Promise<number> {
    const absent = pairs.filter((pair) => pair.own === null);
    const created =
      absent.length === 0
        ? 0
        : (
            await this.prisma.organizationLicense.createMany({
              data: absent.map((pair) => ({
                organizationId: pair.organizationId,
                ...rowOf(pair.columns),
              })),
              skipDuplicates: true,
            })
          ).count;
    let updated = 0;
    // One compare-and-set per row: a dual-write landing after the read is kept.
    for (const { organizationId, columns, own } of pairs) {
      if (own === null) continue;
      const { count } = await this.prisma.organizationLicense.updateMany({
        where: { organizationId, ...rowOf(own) },
        data: rowOf(columns),
      });
      updated += count;
    }
    return created + updated;
  }
}
