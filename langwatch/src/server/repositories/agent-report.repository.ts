import type { AgentReport, Prisma, PrismaClient } from "@prisma/client";

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
    return this.prisma.agentReport.create({ data });
  }

  /**
   * Newest first, without the heavy `sessionData` column: the list view only
   * needs the envelope, the transcript loads per report via `findById`.
   */
  async findAll({
    page,
    pageSize,
  }: {
    page: number;
    pageSize: number;
  }): Promise<Omit<AgentReport, "sessionData">[]> {
    return this.prisma.agentReport.findMany({
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

  async count(): Promise<number> {
    return this.prisma.agentReport.count();
  }
}
