/**
 * The support inbox's rows, over Prisma.
 *
 * Moved out of the application process unchanged: every filter, selection,
 * ordering and return shape is the one the back office has always been served.
 */
import { generate } from "@langwatch/ksuid";
import type { BugReport, BugReportCreateInput } from "@langwatch/ops-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { type Instant, fromDate } from "@langwatch/time";

import type { BugReportRepository } from "../admin/bug-report.repository.ts";

/**
 * The id prefix every report carries.
 *
 * Stated rather than imported: the application's `KSUID_RESOURCES` table is a
 * browser-shared constant map, and one entry of it reaching a server package
 * would drag the whole map. The value is the wire format of every id already
 * stored, so it is pinned by the rows rather than by the constant.
 */
const BUG_REPORT_KSUID_RESOURCE = "bugreport";

/** The columns a listing reads: everything but the stored transcript. */
const bugReportRowSelect = {
  id: true,
  createdAt: true,
  source: true,
  kind: true,
  title: true,
  summary: true,
  sessionTruncated: true,
  agent: true,
  contactEmail: true,
  cliVersion: true,
  linkedProjectId: true,
  metadata: true,
} as const;

export class PrismaBugReportRepository
  extends PrismaRepository.for("BugReport")
  implements BugReportRepository
{
  static readonly create = this.factory((prisma) => new PrismaBugReportRepository(prisma));

  async create({ data }: { data: BugReportCreateInput }): Promise<BugReport> {
    return withInstantCreatedAt(
      await this.prisma.bugReport.create({
        data: {
          ...data,
          // The Json column is written from a value this feature's own contract
          // shapes, so it is narrowed to Prisma's input JSON at the write.
          metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          id: generate(BUG_REPORT_KSUID_RESOURCE).toString(),
        },
      }),
    );
  }

  async findAll({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<Omit<BugReport, "sessionData">[]> {
    const rows = await this.prisma.bugReport.findMany({
      where: findSearchWhere(search),
      select: bugReportRowSelect,
      orderBy: { createdAt: "desc" },
      skip: page * pageSize,
      take: pageSize,
    });

    return rows.map(withInstantCreatedAt);
  }

  async findById({ id }: { id: string }): Promise<BugReport | null> {
    const row = await this.prisma.bugReport.findUnique({ where: { id } });

    return row ? withInstantCreatedAt(row) : null;
  }

  count({ search }: { search?: string | undefined } = {}): Promise<number> {
    return this.prisma.bugReport.count({ where: findSearchWhere(search) });
  }
}

/** The one place a stored row's `createdAt` becomes the instant the contract declares. */
function withInstantCreatedAt<TRow extends { createdAt: Date }>(
  row: TRow,
): Omit<TRow, "createdAt"> & { createdAt: Instant } {
  return { ...row, createdAt: fromDate(row.createdAt) };
}

function findSearchWhere(search: string | undefined): Prisma.BugReportWhereInput | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  return {
    OR: [
      { title: { contains: term, mode: "insensitive" } },
      { summary: { contains: term, mode: "insensitive" } },
      { agent: { contains: term, mode: "insensitive" } },
      { contactEmail: { contains: term, mode: "insensitive" } },
      { linkedProjectId: { contains: term, mode: "insensitive" } },
    ],
  };
}
