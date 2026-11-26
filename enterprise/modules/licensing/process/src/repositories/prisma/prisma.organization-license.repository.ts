import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";
import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import { newerLicense } from "../../rules/license-columns.rules.ts";
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
type OrganizationLicenseDatabase = Pick<
  PrismaClient,
  "organization" | "organizationLicense" | "$transaction" | "$executeRaw"
>;

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

type DatedOrganization = { license: string | null; updatedAt: Date };
type DatedRow = { licenseKey: string | null; updatedAt: Date };

/** The key read: organization's column where it is newer than the row, else the row's. */
const keyOf = ({ organization, own }: { organization: DatedOrganization; own: DatedRow | null }) =>
  newerLicense({
    columns: { licenseKey: organization.license, updatedAt: fromDate(organization.updatedAt) },
    own: own && { licenseKey: own.licenseKey, updatedAt: fromDate(own.updatedAt) },
  }).licenseKey;

/** Licensing's licence rows beside organization's columns, the newer side winning (`keyOf`). */
export class PrismaOrganizationLicenseRepository implements OrganizationLicenseRepository {
  static readonly tables = prismaTables("OrganizationLicense");

  static create(database: OrganizationLicenseDatabase): PrismaOrganizationLicenseRepository {
    return new PrismaOrganizationLicenseRepository(database);
  }

  private constructor(private readonly prisma: OrganizationLicenseDatabase) {}

  async getOrganizationLicense(organizationId: string): Promise<{ licenseKey: string | null }> {
    const [own, organization] = await Promise.all([
      this.prisma.organizationLicense.findUnique({
        where: { organizationId },
        select: { licenseKey: true, updatedAt: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { license: true, updatedAt: true },
      }),
    ]);
    if (organization !== null) return { licenseKey: keyOf({ organization, own }) };
    if (own === null) throw new OrganizationNotFoundError();
    return { licenseKey: own.licenseKey };
  }

  // Organization carries no archive column today; when one is added, exclude it
  // here so an archived organization cannot keep an installation licensed.
  async findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]> {
    const own = await this.prisma.organizationLicense.findMany({
      select: { organizationId: true, licenseKey: true, updatedAt: true },
    });
    const keyed = own.flatMap((row) => (row.licenseKey === null ? [] : [row.organizationId]));
    const organizations = await this.prisma.organization.findMany({
      where: { OR: [{ license: { not: null } }, { id: { in: keyed } }] },
      select: { id: true, license: true, updatedAt: true },
    });
    const rows = new Map(own.map((row) => [row.organizationId, row]));
    const found = new Set(organizations.map((organization) => organization.id));
    return [
      ...organizations.flatMap((organization) => {
        const licenseKey = keyOf({ organization, own: rows.get(organization.id) ?? null });
        return licenseKey === null ? [] : [{ organizationId: organization.id, licenseKey }];
      }),
      ...own.flatMap((row) =>
        row.licenseKey === null || found.has(row.organizationId)
          ? []
          : [{ organizationId: row.organizationId, licenseKey: row.licenseKey }],
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

  async findLicense({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<LicenseColumns[]> {
    const row = await this.prisma.organizationLicense.findUnique({
      where: { organizationId },
      select: { licenseKey: true, expiresAt: true, validatedAt: true },
    });
    return row === null ? [] : [licenseOf(row)];
  }

  async restoreLicense({
    organizationId,
    written,
    previous,
  }: Readonly<{
    organizationId: string;
    written: LicenseColumns;
    previous: LicenseColumns | null;
  }>): Promise<void> {
    const where = { organizationId, ...rowOf(written) };
    if (previous === null) await this.prisma.organizationLicense.deleteMany({ where });
    else await this.prisma.organizationLicense.updateMany({ where, data: rowOf(previous) });
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

  async replaceLicense({
    organizationId,
    license,
    replacing,
  }: Readonly<{
    organizationId: string;
    license: StoredLicense;
    replacing: string | null;
  }>): Promise<boolean> {
    const row = rowOf(license);
    // One statement over the key the install reads (newerLicense): the column while newer,
    // else the row. A row written meanwhile is compared again by key on conflict. The new
    // row is stamped after the locked column it read, so it is the key reads see next.
    const written = await this.prisma.$executeRaw`
      ${skipTenantCheck({
        // Licences are keyed by organization; this write names its organization by id.
        SKIP_TENANT_CHECK: true,
      })}
      WITH held AS (
        SELECT o."id",
               o."updatedAt" AS "columnUpdatedAt",
               o."license" AS "columnKey",
               CASE WHEN ol."organizationId" IS NULL OR o."updatedAt" > ol."updatedAt"
                    THEN o."license" ELSE ol."licenseKey" END AS "key"
          FROM "Organization" o
          LEFT JOIN "OrganizationLicense" ol ON ol."organizationId" = o."id"
         WHERE o."id" = ${organizationId}
           FOR SHARE OF o
      )
      INSERT INTO "OrganizationLicense"
             ("organizationId", "licenseKey", "expiresAt", "validatedAt", "updatedAt")
      SELECT "id", ${row.licenseKey}, ${row.expiresAt}, ${row.validatedAt},
             GREATEST(clock_timestamp(), "columnUpdatedAt" + interval '1 millisecond')
        FROM held
       WHERE "key" IS NOT DISTINCT FROM ${replacing}
      ON CONFLICT ("organizationId") DO UPDATE
         SET "licenseKey" = EXCLUDED."licenseKey",
             "expiresAt" = EXCLUDED."expiresAt",
             "validatedAt" = EXCLUDED."validatedAt",
             "updatedAt" = EXCLUDED."updatedAt"
       WHERE (CASE WHEN (SELECT "columnUpdatedAt" FROM held) > "OrganizationLicense"."updatedAt"
                   THEN (SELECT "columnKey" FROM held)
                   ELSE "OrganizationLicense"."licenseKey" END) IS NOT DISTINCT FROM ${replacing}
    `;
    return written > 0;
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
      select: {
        id: true,
        license: true,
        licenseExpiresAt: true,
        licenseLastValidatedAt: true,
        updatedAt: true,
      },
    });
    const held = await this.prisma.organizationLicense.findMany({
      where: { organizationId: { in: page.map((organization) => organization.id) } },
      select: {
        organizationId: true,
        licenseKey: true,
        expiresAt: true,
        validatedAt: true,
        updatedAt: true,
      },
    });
    const own = new Map(held.map((row) => [row.organizationId, row]));
    return page.map((organization) => {
      const row = own.get(organization.id);
      return {
        organizationId: organization.id,
        columns: licenseOf({
          licenseKey: organization.license,
          expiresAt: organization.licenseExpiresAt,
          validatedAt: organization.licenseLastValidatedAt,
        }),
        columnsUpdatedAt: fromDate(organization.updatedAt),
        own: row === undefined ? null : licenseOf(row),
        ownUpdatedAt: row === undefined ? null : fromDate(row.updatedAt),
      };
    });
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
    for (const { organizationId, columns, own, ownUpdatedAt } of pairs) {
      if (own === null || ownUpdatedAt === null) continue;
      updated += await this.overwriteIfUnchanged({ organizationId, columns, own, ownUpdatedAt });
    }
    return created + updated;
  }

  /**
   * One transaction holds organization's row, checks its columns are still the
   * ones read and compares-and-sets licensing's row on its `updatedAt`, so a
   * write that reached either side after the read is kept.
   */
  private overwriteIfUnchanged({
    organizationId,
    columns,
    own,
    ownUpdatedAt,
  }: Readonly<{
    organizationId: string;
    columns: LicenseColumns;
    own: LicenseColumns;
    ownUpdatedAt: Instant;
  }>) {
    const source = rowOf(columns);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT 1 FROM "Organization" WHERE "id" = ${organizationId} FOR SHARE
      `;
      const unchanged = await transaction.organization.count({
        where: {
          id: organizationId,
          license: source.licenseKey,
          licenseExpiresAt: source.expiresAt,
          licenseLastValidatedAt: source.validatedAt,
        },
      });
      if (unchanged === 0) return 0;
      const { count } = await transaction.organizationLicense.updateMany({
        where: { organizationId, ...rowOf(own), updatedAt: toDate(ownUpdatedAt) },
        data: source,
      });
      return count;
    });
  }
}
