/**
 * Prisma bindings for the license registry (ADR-141). The services are built
 * in `./composition.ts`.
 */

import { nanoid } from "nanoid";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { slugify } from "~/utils/slugify";
import type {
  CustomerOrganizationPort,
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "./issuedLicense";
import type {
  LicenseSeatQuarterKey,
  LicenseSeatReportRecord,
  LicenseSeatReportRepository,
} from "./seatReports";

/**
 * A transaction client carries the same model methods, so a caller that needs
 * the row and its own writes to land together passes one in.
 */
type RegistryClient = PrismaClient | Prisma.TransactionClient;

export class PrismaIssuedLicenseRepository implements IssuedLicenseRepository {
  constructor(private readonly prisma: RegistryClient) {}

  async create(
    data: Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<IssuedLicenseRecord> {
    return this.prisma.issuedLicense.create({ data });
  }

  async findById(id: string): Promise<IssuedLicenseRecord | null> {
    return this.prisma.issuedLicense.findUnique({ where: { id } });
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<IssuedLicenseRecord | null> {
    return this.prisma.issuedLicense.findUnique({ where: { tokenHash } });
  }

  async findByVirtualKeyId(
    virtualKeyId: string,
  ): Promise<IssuedLicenseRecord | null> {
    return this.prisma.issuedLicense.findUnique({ where: { virtualKeyId } });
  }

  async findByReplacesId(
    replacesId: string,
  ): Promise<IssuedLicenseRecord | null> {
    return this.prisma.issuedLicense.findUnique({ where: { replacesId } });
  }

  async findAllByOrganization(
    organizationId: string,
  ): Promise<IssuedLicenseRecord[]> {
    return this.prisma.issuedLicense.findMany({ where: { organizationId } });
  }

  async findAll({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: IssuedLicenseRecord[]; total: number }> {
    const term = search?.trim();
    const where: Prisma.IssuedLicenseWhereInput = term
      ? {
          OR: [
            { organizationName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            { licenseId: { contains: term, mode: "insensitive" } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.issuedLicense.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
      this.prisma.issuedLicense.count({ where }),
    ]);
    return { rows, total };
  }

  async update(
    id: string,
    data: Partial<Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<IssuedLicenseRecord> {
    return this.prisma.issuedLicense.update({ where: { id }, data });
  }

  async bindInstance({
    id,
    instanceId,
    at,
  }: {
    id: string;
    instanceId: string;
    at: Date;
  }): Promise<boolean> {
    // One conditional write, so the database decides which install wins. As
    // SQL, for the reason given above `attachVirtualKey`.
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: a license is addressed by its own primary key. The row names
      -- the organization it was issued to rather than belonging to one.
      UPDATE "IssuedLicense"
         SET "instanceId" = ${instanceId},
             "instanceBoundAt" = ${at},
             "updatedAt" = now()
       WHERE "id" = ${id}
         AND "instanceId" IS NULL
    `;
    return updated === 1;
  }

  async attachVirtualKey({
    id,
    virtualKeyId,
    requires,
  }: {
    id: string;
    virtualKeyId: string;
    requires: { organizationId: string; instanceId: string; activeAt: Date };
  }): Promise<boolean> {
    // The state the caller resolved against is part of the write, so a
    // revocation, a supersede, the term running out or a move to another
    // customer between the read and this statement loses the key its grant.
    //
    // Stated as SQL rather than through `updateMany`, which does not hold under
    // concurrency. Prisma compiles `updateMany` to
    // `UPDATE ... WHERE id IN (SELECT id FROM ... WHERE <conditions>)`. When two
    // statements meet on the same row the second waits for the first to commit
    // and then re-checks its WHERE clause against the row as it now stands,
    // which for that shape is only the subquery, and the subquery still runs on
    // the statement's own older snapshot: both are told yes. With the conditions
    // against the table the re-check sees the new values and the second updates
    // nothing. Proved on the twin of this write in
    // ee/licensing/activation/__tests__/activationCode.prisma.integration.test.ts.
    const updated = await this.prisma.$executeRaw`
      UPDATE "IssuedLicense"
         SET "virtualKeyId" = ${virtualKeyId},
             "updatedAt" = now()
       WHERE "id" = ${id}
         AND "virtualKeyId" IS NULL
         AND "organizationId" = ${requires.organizationId}
         AND "instanceId" = ${requires.instanceId}
         AND "revokedAt" IS NULL
         AND "supersededAt" IS NULL
         AND "expiresAt" > ${requires.activeAt}
    `;
    return updated === 1;
  }
}

export class PrismaLicenseSeatReports implements LicenseSeatReportRepository {
  constructor(private readonly prisma: RegistryClient) {}

  /**
   * One statement, so two syncs arriving together cannot each read the old
   * peak and write the lower of the two figures back. `GREATEST` is what makes
   * the write idempotent: replaying a day's report changes nothing.
   */
  async recordPeak({
    licenseId,
    quarterStartsAt,
    members,
    membersLite,
    at,
  }: {
    licenseId: string;
    quarterStartsAt: Date;
    members: number;
    membersLite: number;
    at: Date;
  }): Promise<LicenseSeatReportRecord> {
    const rows = await this.prisma.$queryRaw<LicenseSeatReportRecord[]>`
      -- @tenancy: scoped by "licenseId", the IssuedLicense row the presented
      -- license token has just resolved to; that row is what names the customer
      -- and this table carries no organizationId of its own.
      INSERT INTO "LicenseSeatReport" (
        "id", "licenseId", "quarterStartsAt", "peakMembers", "peakMembersLite",
        "firstReportedAt", "lastReportedAt"
      )
      VALUES (
        ${nanoid()}, ${licenseId}, ${quarterStartsAt}, ${members}, ${membersLite},
        ${at}, ${at}
      )
      ON CONFLICT ("licenseId", "quarterStartsAt") DO UPDATE SET
        "peakMembers" = GREATEST(
          "LicenseSeatReport"."peakMembers", EXCLUDED."peakMembers"
        ),
        "peakMembersLite" = GREATEST(
          "LicenseSeatReport"."peakMembersLite", EXCLUDED."peakMembersLite"
        ),
        "lastReportedAt" = EXCLUDED."lastReportedAt"
      RETURNING *
    `;
    const report = rows[0];
    if (!report) {
      throw new Error(`no seat report written for license ${licenseId}`);
    }
    return report;
  }

  async findByQuarters(
    keys: LicenseSeatQuarterKey[],
  ): Promise<LicenseSeatReportRecord[]> {
    if (keys.length === 0) return [];
    return this.prisma.licenseSeatReport.findMany({
      where: {
        OR: keys.map(({ licenseId, quarterStartsAt }) => ({
          licenseId,
          quarterStartsAt,
        })),
      },
    });
  }
}

export class PrismaCustomerOrganizations implements CustomerOrganizationPort {
  constructor(private readonly prisma: RegistryClient) {}

  async findById(id: string): Promise<{ id: string; name: string } | null> {
    return this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
  }

  /**
   * A customer organization for a self-hosted customer has no LangWatch Cloud
   * users, so it is created bare. The suffix keeps the slug unique when two
   * customers share a name.
   */
  async createSelfHostedCustomer({
    name,
  }: {
    name: string;
  }): Promise<{ id: string; name: string }> {
    return this.prisma.organization.create({
      data: {
        name,
        slug: `${slugify(name) || "customer"}-${nanoid(6).toLowerCase()}`,
        selfHostedCustomer: true,
      },
      select: { id: true, name: true },
    });
  }

  async markSelfHostedCustomer(id: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id },
      data: { selfHostedCustomer: true },
    });
  }
}
