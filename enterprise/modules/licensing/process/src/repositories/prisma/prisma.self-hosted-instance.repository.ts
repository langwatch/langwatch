import { SelfHostedInstanceNotFoundError } from "@langwatch/enterprise-licensing-contract";
import {
  Prisma,
  type PrismaClient,
  type SelfHostedInstance,
} from "@langwatch/prisma-client/generated";
import { fromDate, toDate } from "@langwatch/time";

import type {
  SelfHostedInstanceRecord,
  SelfHostedInstanceRepository,
  SelfHostedInstanceUpsert,
  SelfHostedReportInsert,
  SelfHostedReportRecord,
} from "../self-hosted-instance.repository.ts";

export type SelfHostedInstanceDatabase = Pick<
  PrismaClient,
  "selfHostedInstance" | "selfHostedInstanceReport"
>;

export class PrismaSelfHostedInstanceRepository implements SelfHostedInstanceRepository {
  static create(database: SelfHostedInstanceDatabase): PrismaSelfHostedInstanceRepository {
    return new PrismaSelfHostedInstanceRepository(database);
  }

  private constructor(private readonly prisma: SelfHostedInstanceDatabase) {}

  async upsert(row: SelfHostedInstanceUpsert): Promise<void> {
    const shared = {
      lastSeenAt: toDate(row.lastSeenAt),
      version: row.version,
      installMethod: row.installMethod,
      chartVersion: row.chartVersion,
      hostname: row.hostname,
      environment: row.environment,
      installedAt: row.installedAt === null ? null : toDate(row.installedAt),
      reportSchemaVersion: row.reportSchemaVersion,
      organizationId: row.organizationId,
      issuedLicenseId: row.issuedLicenseId,
      userEmailDomains: row.userEmailDomains ?? Prisma.DbNull,
      userDomains: Object.keys(row.userEmailDomains ?? {}),
      raisedSignals: [...row.raisedSignals],
      latestReport: jsonOf(row.latestReport),
      optionalMetricsReported: row.optionalMetricsReported,
      hostnameReported: row.hostnameReported,
      lastUnknownFields: row.lastUnknownFields,
    };
    // `firstSeenAt` is written only on create, so a later report never moves it.
    await this.prisma.selfHostedInstance.upsert({
      where: { instanceId: row.instanceId },
      create: {
        instanceId: row.instanceId,
        firstSeenAt: toDate(row.lastSeenAt),
        reportCount: 1,
        ...shared,
      },
      update: { reportCount: { increment: 1 }, ...shared },
    });
  }

  async appendReport(report: SelfHostedReportInsert): Promise<void> {
    await this.prisma.selfHostedInstanceReport.create({
      data: {
        instanceId: report.instanceId,
        receivedAt: toDate(report.receivedAt),
        version: report.version,
        reportSchemaVersion: report.reportSchemaVersion,
        unknownFields: report.unknownFields,
        payload: jsonOf(report.payload),
      },
    });
  }

  async findPage(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: SelfHostedInstanceRecord[]; total: number }> {
    const where = searchWhere(input.search);
    const [rows, total] = await Promise.all([
      this.prisma.selfHostedInstance.findMany({
        where,
        orderBy: { lastSeenAt: "desc" },
        skip: input.page * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.selfHostedInstance.count({ where }),
    ]);
    return { rows: rows.map(recordOf), total };
  }

  async getById(id: string): Promise<SelfHostedInstanceRecord> {
    const row = await this.prisma.selfHostedInstance.findUnique({ where: { id } });
    if (!row) throw new SelfHostedInstanceNotFoundError();
    return recordOf(row);
  }

  async findByInstanceId(instanceId: string): Promise<SelfHostedInstanceRecord[]> {
    const row = await this.prisma.selfHostedInstance.findUnique({ where: { instanceId } });
    return row ? [recordOf(row)] : [];
  }

  async findReports(input: {
    instanceId: string;
    limit: number;
  }): Promise<SelfHostedReportRecord[]> {
    const rows = await this.prisma.selfHostedInstanceReport.findMany({
      where: { instanceId: input.instanceId },
      orderBy: { receivedAt: "desc" },
      take: input.limit,
      select: { id: true, receivedAt: true, version: true, unknownFields: true },
    });
    return rows.map((row) => ({ ...row, receivedAt: fromDate(row.receivedAt) }));
  }
}

/** A JSON object column read back; anything else the writer never put there reads as empty. */
function objectOf(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return { ...value };
}

function domainsOf(value: Prisma.JsonValue): Record<string, number> {
  return Object.fromEntries(
    Object.entries(objectOf(value)).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

/** A report is the JSON the receiver parsed, so it round-trips as JSON. */
function jsonOf(value: Record<string, unknown>): Prisma.InputJsonObject {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
}

function recordOf(row: SelfHostedInstance): SelfHostedInstanceRecord {
  return {
    id: row.id,
    instanceId: row.instanceId,
    firstSeenAt: fromDate(row.firstSeenAt),
    lastSeenAt: fromDate(row.lastSeenAt),
    version: row.version,
    installMethod: row.installMethod,
    chartVersion: row.chartVersion,
    hostname: row.hostname,
    environment: row.environment,
    installedAt: row.installedAt === null ? null : fromDate(row.installedAt),
    reportSchemaVersion: row.reportSchemaVersion,
    organizationId: row.organizationId,
    issuedLicenseId: row.issuedLicenseId,
    userEmailDomains: row.userEmailDomains === null ? null : domainsOf(row.userEmailDomains),
    latestReport: row.latestReport === null ? null : objectOf(row.latestReport),
    optionalMetricsReported: row.optionalMetricsReported,
    hostnameReported: row.hostnameReported,
    reportCount: row.reportCount,
    lastUnknownFields: row.lastUnknownFields,
    raisedSignals: row.raisedSignals,
  };
}

/** Part of the id, hostname, release or install method; a domain matches whole. */
function searchWhere(search: string | undefined): Prisma.SelfHostedInstanceWhereInput {
  const term = search?.trim();
  if (!term) return {};
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
