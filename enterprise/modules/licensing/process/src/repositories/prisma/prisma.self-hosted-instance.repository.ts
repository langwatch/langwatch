import { SelfHostedInstanceNotFoundError } from "@langwatch/enterprise-licensing-contract";
import type { SelfHostedInstanceSort } from "@langwatch/enterprise-licensing-contract";
import { skipTenantCheck } from "@langwatch/prisma-client";
import {
  Prisma,
  type PrismaClient,
  type SelfHostedInstance,
} from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import type {
  SelfHostedInstanceQuery,
  SelfHostedInstanceRecord,
  SelfHostedInstanceRepository,
  SelfHostedInstanceTally,
  SelfHostedInstanceUpsert,
  SelfHostedReportInsert,
  SelfHostedReportRecord,
} from "../self-hosted-instance.repository.ts";

type SelfHostedInstanceDatabase = Pick<
  PrismaClient,
  "selfHostedInstance" | "selfHostedInstanceReport" | "$queryRaw"
>;

/** The registry is the platform's own: an install row belongs to no tenant. */
const PLATFORM_TABLE = skipTenantCheck({
  // An install is addressed by the instance id it minted; no organization or project owns the row.
  SKIP_TENANT_CHECK: true,
});

/** A number the last report carried under `key`, or null; Prisma cannot order by a JSON path. */
function reported(key: string): Prisma.Sql {
  return Prisma.sql`CASE WHEN jsonb_typeof("latestReport"->${key}) = 'number'
    THEN ("latestReport"->>${key})::float8 END`;
}

const ORDER_BY: Record<SelfHostedInstanceSort, Prisma.Sql> = {
  last_report: Prisma.sql`"lastSeenAt" DESC`,
  newest: Prisma.sql`"firstSeenAt" DESC`,
  traces_28d: Prisma.sql`${reported("traces_28d")} DESC NULLS LAST, "lastSeenAt" DESC`,
  users: Prisma.sql`${reported("users")} DESC NULLS LAST, "lastSeenAt" DESC`,
  active_users_28d: Prisma.sql`${reported("active_users_28d")} DESC NULLS LAST, "lastSeenAt" DESC`,
};

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

  async listPage(
    input: SelfHostedInstanceQuery,
  ): Promise<{ rows: SelfHostedInstanceRecord[]; total: number }> {
    const where = whereOf(input);
    const [page, [counted]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        ${PLATFORM_TABLE}
        SELECT "id" FROM "SelfHostedInstance" ${where}
        ORDER BY ${ORDER_BY[input.sort]}, "id"
        LIMIT ${input.pageSize} OFFSET ${input.page * input.pageSize}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        ${PLATFORM_TABLE}
        SELECT count(*)::int AS "total" FROM "SelfHostedInstance" ${where}`,
    ]);
    const ids = page.map((row) => row.id);
    const rows = await this.prisma.selfHostedInstance.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      rows: ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [recordOf(row)] : [];
      }),
      total: counted?.total ?? 0,
    };
  }

  async tally({
    reportingSince,
    quietSince,
    releaseLimit,
  }: {
    reportingSince: Instant;
    quietSince: Instant;
    releaseLimit: number;
  }): Promise<SelfHostedInstanceTally> {
    const reportingAt = toDate(reportingSince);
    const quietAt = toDate(quietSince);
    const [[counts], signals, releases] = await Promise.all([
      this.prisma.$queryRaw<Omit<SelfHostedInstanceTally, "signals" | "releases">[]>`
        ${PLATFORM_TABLE}
        SELECT
          count(*)::int AS "total",
          (count(*) FILTER (WHERE "lastSeenAt" >= ${reportingAt}))::int AS "reporting",
          (count(*) FILTER (WHERE "lastSeenAt" < ${reportingAt}
            AND "lastSeenAt" >= ${quietAt}))::int AS "quiet",
          (count(*) FILTER (WHERE "organizationId" IS NOT NULL))::int AS "licensed",
          coalesce(sum(${reported("traces_28d")})
            FILTER (WHERE "lastSeenAt" >= ${reportingAt}), 0)::float8 AS "traces28d"
        FROM "SelfHostedInstance"`,
      this.prisma.$queryRaw<{ signal: string; count: number }[]>`
        ${PLATFORM_TABLE}
        SELECT "signal", count(*)::int AS "count"
        FROM "SelfHostedInstance", unnest("raisedSignals") AS "signal"
        GROUP BY "signal" ORDER BY "count" DESC, "signal"`,
      this.prisma.$queryRaw<{ version: string; count: number }[]>`
        ${PLATFORM_TABLE}
        SELECT "version", count(*)::int AS "count" FROM "SelfHostedInstance"
        WHERE "version" IS NOT NULL AND "lastSeenAt" >= ${quietAt}
        GROUP BY "version" ORDER BY "count" DESC, "version" DESC
        LIMIT ${releaseLimit}`,
    ]);
    return {
      total: counts?.total ?? 0,
      reporting: counts?.reporting ?? 0,
      quiet: counts?.quiet ?? 0,
      licensed: counts?.licensed ?? 0,
      traces28d: counts?.traces28d ?? 0,
      signals,
      releases,
    };
  }

  async findFirstSeenSince(since: Instant): Promise<Instant[]> {
    const rows = await this.prisma.selfHostedInstance.findMany({
      where: { firstSeenAt: { gte: toDate(since) } },
      select: { firstSeenAt: true },
    });
    return rows.map((row) => fromDate(row.firstSeenAt));
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

/** Search is part of the id, hostname, release or install method, or a whole domain. */
function whereOf(input: SelfHostedInstanceQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  const term = input.search?.trim();
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    conditions.push(Prisma.sql`("instanceId" ILIKE ${like} OR "hostname" ILIKE ${like}
      OR "version" ILIKE ${like} OR "installMethod" ILIKE ${like}
      OR ${term.toLowerCase()} = ANY("userDomains"))`);
  }
  if (input.licensed === true) conditions.push(Prisma.sql`"organizationId" IS NOT NULL`);
  if (input.licensed === false) conditions.push(Prisma.sql`"organizationId" IS NULL`);
  if (input.seenSince) conditions.push(Prisma.sql`"lastSeenAt" >= ${toDate(input.seenSince)}`);
  if (input.seenBefore) conditions.push(Prisma.sql`"lastSeenAt" < ${toDate(input.seenBefore)}`);
  if (input.signal) conditions.push(Prisma.sql`${input.signal} = ANY("raisedSignals")`);
  return conditions.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;
}
