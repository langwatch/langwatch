import { generate } from "@langwatch/ksuid";
import type { AgentReport, Prisma, PrismaClient } from "@prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Storage for agent issue reports (`langwatch report` / the MCP report tool).
 * A global support inbox: no tenancy column, read only from the admin
 * backoffice (see dbMultiTenancyProtection GLOBAL_MODELS).
 */
export class AgentReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create({
    data,
  }: {
    data: Prisma.AgentReportCreateInput;
  }): Promise<AgentReport> {
    return this.prisma.agentReport.create({
      data: {
        id: generate(KSUID_RESOURCES.AGENT_REPORT).toString(),
        ...data,
      },
    });
  }

  /**
   * Newest first, without the heavy `sessionData` column: the list view only
   * needs the envelope, the transcript loads per report via `findById`.
   */
  async findAll({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<Omit<AgentReport, "sessionData">[]> {
    return this.prisma.agentReport.findMany({
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

  async findById({ id }: { id: string }): Promise<AgentReport | null> {
    return this.prisma.agentReport.findUnique({ where: { id } });
  }

  async count({ search }: { search?: string } = {}): Promise<number> {
    return this.prisma.agentReport.count({ where: buildSearchWhere(search) });
  }
}

function buildSearchWhere(
  search: string | undefined,
): Prisma.AgentReportWhereInput | undefined {
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
