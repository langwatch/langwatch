import { type PrismaClient, type ScimRequestLog, type Prisma } from "@prisma/client";

interface ScimRequestLogFilter {
  organizationId: string;
  statusFilter?: "all" | "success" | "4xx" | "5xx";
  pathSearch?: string;
  cursor?: string;
  limit: number;
}

interface ScimRequestLogPage {
  items: ScimRequestLog[];
  nextCursor: string | undefined;
}

export class ScimRequestLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ScimRequestLogRepository {
    return new ScimRequestLogRepository(prisma);
  }

  async findByOrganization({
    organizationId,
    statusFilter = "all",
    pathSearch,
    cursor,
    limit,
  }: ScimRequestLogFilter): Promise<ScimRequestLogPage> {
    const where: Record<string, unknown> = { organizationId };

    if (statusFilter === "success") {
      where.responseStatus = { gte: 200, lt: 300 };
    } else if (statusFilter === "4xx") {
      where.responseStatus = { gte: 400, lt: 500 };
    } else if (statusFilter === "5xx") {
      where.responseStatus = { gte: 500 };
    }

    if (pathSearch) {
      where.requestPath = { contains: pathSearch, mode: "insensitive" };
    }

    const logs = await this.prisma.scimRequestLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = logs.length > limit;
    const items = hasMore ? logs.slice(0, limit) : logs;

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
    };
  }

  async create({
    organizationId,
    requestMethod,
    requestPath,
    responseStatus,
    durationMs,
    identityProvider,
    requestHeaders,
    requestBody,
    responseBody,
  }: {
    organizationId: string;
    requestMethod: string;
    requestPath: string;
    responseStatus: number;
    durationMs: number;
    identityProvider: string | null;
    requestHeaders?: Prisma.InputJsonValue | null;
    requestBody?: Prisma.InputJsonValue | null;
    responseBody?: Prisma.InputJsonValue | null;
  }): Promise<void> {
    await this.prisma.scimRequestLog.create({
      data: {
        organizationId,
        requestMethod,
        requestPath,
        responseStatus,
        durationMs,
        identityProvider,
        requestHeaders: requestHeaders ?? undefined,
        requestBody: requestBody ?? undefined,
        responseBody: responseBody ?? undefined,
      },
    });
  }
}
