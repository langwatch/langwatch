/**
 * The registry of self-hosted installs, over Prisma (ADR-139, section 10).
 *
 * @see ./selfHostedInstance.service.ts
 */

// `Prisma` is a value here as well as a namespace: `Prisma.DbNull` is what a
// nullable Json column takes for SQL NULL.
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import type {
  InstanceOwner,
  InstanceOwnerLookup,
  InstanceReportInsert,
  InstanceRowUpsert,
  OrganizationNameLookup,
  ReportProperties,
  SelfHostedInstanceRecord,
  SelfHostedInstanceRepository,
} from "./selfHostedInstances";

/** A JSON column read back, narrowed to the object the writer put there. */
function objectOf<T>(value: Prisma.JsonValue | null): T | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as T;
}

type Row = Awaited<
  ReturnType<PrismaClient["selfHostedInstance"]["findFirstOrThrow"]>
>;

function recordOf(row: Row): SelfHostedInstanceRecord {
  return {
    id: row.id,
    instanceId: row.instanceId,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    version: row.version,
    installMethod: row.installMethod,
    chartVersion: row.chartVersion,
    hostname: row.hostname,
    environment: row.environment,
    installedAt: row.installedAt,
    reportSchemaVersion: row.reportSchemaVersion,
    organizationId: row.organizationId,
    issuedLicenseId: row.issuedLicenseId,
    userEmailDomains: objectOf<Record<string, number>>(row.userEmailDomains),
    latestReport: objectOf<ReportProperties>(row.latestReport),
    optionalMetricsReported: row.optionalMetricsReported,
    hostnameReported: row.hostnameReported,
    reportCount: row.reportCount,
    lastUnknownFields: row.lastUnknownFields,
    raisedSignals: row.raisedSignals,
  };
}

export class PrismaSelfHostedInstances implements SelfHostedInstanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(row: InstanceRowUpsert): Promise<void> {
    const shared = {
      lastSeenAt: row.lastSeenAt,
      version: row.version,
      installMethod: row.installMethod,
      chartVersion: row.chartVersion,
      hostname: row.hostname,
      environment: row.environment,
      installedAt: row.installedAt,
      reportSchemaVersion: row.reportSchemaVersion,
      organizationId: row.organizationId,
      issuedLicenseId: row.issuedLicenseId,
      // `DbNull` rather than `null`: a nullable Json column takes SQL NULL
      // that way, and plain `null` is not a value Prisma accepts here.
      userEmailDomains: (row.userEmailDomains ??
        Prisma.DbNull) as Prisma.InputJsonValue,
      userDomains: Object.keys(row.userEmailDomains ?? {}),
      raisedSignals: row.raisedSignals,
      latestReport: row.latestReport as Prisma.InputJsonValue,
      optionalMetricsReported: row.optionalMetricsReported,
      hostnameReported: row.hostnameReported,
      lastUnknownFields: row.lastUnknownFields,
    };

    await this.prisma.selfHostedInstance.upsert({
      where: { instanceId: row.instanceId },
      // `firstSeenAt` is only ever written here, so a later report can never
      // move the day an install was first heard from.
      create: {
        instanceId: row.instanceId,
        firstSeenAt: row.lastSeenAt,
        reportCount: 1,
        ...shared,
      },
      update: { reportCount: { increment: 1 }, ...shared },
    });
  }

  async appendReport(report: InstanceReportInsert): Promise<void> {
    await this.prisma.selfHostedInstanceReport.create({
      data: {
        instanceId: report.instanceId,
        receivedAt: report.receivedAt,
        version: report.version,
        reportSchemaVersion: report.reportSchemaVersion,
        unknownFields: report.unknownFields,
        payload: report.payload as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: SelfHostedInstanceRecord[]; total: number }> {
    const where = searchWhere(input.search);
    const [rows, total] = await Promise.all([
      this.prisma.selfHostedInstance.findMany({
        where,
        // Most recent activity first: an install that reported an hour ago is
        // the one an operator wants to see, and one silent for a year is not.
        orderBy: { lastSeenAt: "desc" },
        skip: input.page * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.selfHostedInstance.count({ where }),
    ]);
    return { rows: rows.map(recordOf), total };
  }

  async findById(id: string): Promise<SelfHostedInstanceRecord | null> {
    const row = await this.prisma.selfHostedInstance.findUnique({
      where: { id },
    });
    return row ? recordOf(row) : null;
  }

  async findByInstanceId(
    instanceId: string,
  ): Promise<SelfHostedInstanceRecord | null> {
    const row = await this.prisma.selfHostedInstance.findUnique({
      where: { instanceId },
    });
    return row ? recordOf(row) : null;
  }

  async findReports(input: { instanceId: string; limit: number }) {
    return this.prisma.selfHostedInstanceReport.findMany({
      where: { instanceId: input.instanceId },
      orderBy: { receivedAt: "desc" },
      take: input.limit,
      select: {
        id: true,
        receivedAt: true,
        version: true,
        unknownFields: true,
      },
    });
  }
}

/**
 * What an operator types in the search box.
 *
 * The instance id, the hostname and the release are the three they have in
 * hand coming from a support thread or a log line, and each matches on part of
 * the value. The domain answers "which install does this company run" and
 * matches whole, because it is an element of an array rather than a string to
 * scan: an operator searching by company types the domain they were given.
 */
function searchWhere(
  search: string | undefined,
): Prisma.SelfHostedInstanceWhereInput | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  return {
    OR: [
      { instanceId: { contains: term, mode: "insensitive" } },
      { hostname: { contains: term, mode: "insensitive" } },
      { version: { contains: term, mode: "insensitive" } },
      { installMethod: { contains: term, mode: "insensitive" } },
      { userDomains: { has: term.toLowerCase() } },
    ],
  };
}

/**
 * The customer behind an install, taken from the license bound to it.
 *
 * Binding happens in license sync, after the install has presented its token,
 * so this is the one attribution a report cannot influence. An install that
 * has never synced a license resolves to nothing, which is the correct answer
 * for the open source baseline.
 */
export class PrismaInstanceOwners implements InstanceOwnerLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async findByInstanceId(instanceId: string): Promise<InstanceOwner | null> {
    const license = await this.prisma.issuedLicense.findFirst({
      where: { instanceId, revokedAt: null },
      orderBy: { instanceBoundAt: "desc" },
      select: { id: true, organizationId: true, expiresAt: true },
    });
    if (!license) return null;
    return {
      organizationId: license.organizationId,
      issuedLicenseId: license.id,
      expiresAt: license.expiresAt,
    };
  }
}

export class PrismaOrganizationNames implements OrganizationNameLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async findNames(
    organizationIds: string[],
  ): Promise<Record<string, string | undefined>> {
    const rows = await this.prisma.organization.findMany({
      where: { id: { in: organizationIds } },
      select: { id: true, name: true },
    });
    return Object.fromEntries(rows.map((row) => [row.id, row.name]));
  }
}
