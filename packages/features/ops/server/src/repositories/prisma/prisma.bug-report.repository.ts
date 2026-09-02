/**
 * The support inbox's rows, over Prisma.
 *
 * Moved out of the application process unchanged: every filter, selection,
 * ordering and return shape is the one the back office has always been served.
 */
import { generate } from "@langwatch/ksuid";
import type { BugReport, Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { BugReportRepository } from "../../ports/bug-report.repository";

/**
 * The id prefix every report carries.
 *
 * Stated rather than imported: the application's `KSUID_RESOURCES` table is a
 * browser-shared constant map, and one entry of it reaching a server package
 * would drag the whole map. The value is the wire format of every id already
 * stored, so it is pinned by the rows rather than by the constant.
 */
const BUG_REPORT_KSUID_RESOURCE = "bugreport";

export class PrismaBugReportRepository extends BugReportRepository {
  static create(options: { prisma: PrismaClient }): PrismaBugReportRepository {
    return new PrismaBugReportRepository(options.prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  create({ data }: { data: Prisma.BugReportCreateInput }): Promise<BugReport> {
    return this.prisma.bugReport.create({
      data: {
        id: generate(BUG_REPORT_KSUID_RESOURCE).toString(),
        ...data,
      },
    });
  }

  findAll({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<Omit<BugReport, "sessionData">[]> {
    return this.prisma.bugReport.findMany({
      where: buildSearchWhere(search),
      select: {
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
      },
      orderBy: { createdAt: "desc" },
      skip: page * pageSize,
      take: pageSize,
    });
  }

  findById({ id }: { id: string }): Promise<BugReport | null> {
    return this.prisma.bugReport.findUnique({ where: { id } });
  }

  count({ search }: { search?: string | undefined } = {}): Promise<number> {
    return this.prisma.bugReport.count({ where: buildSearchWhere(search) });
  }
}

function buildSearchWhere(search: string | undefined): Prisma.BugReportWhereInput | undefined {
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
