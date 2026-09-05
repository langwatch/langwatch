import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  GatewayTraceDestinationReportRepository,
  type TraceDestinationKeyRow,
  type TraceDestinationProjectRow,
} from "../gateway-trace-destination-report.repository";

const PROJECT_SELECT = {
  id: true,
  kind: true,
  archivedAt: true,
  createdAt: true,
  team: { select: { organizationId: true } },
} as const;

const KEY_SELECT = {
  id: true,
  organizationId: true,
  traceProjectId: true,
  scopes: { select: { scopeType: true, scopeId: true } },
} as const;

/**
 * Read-only, and picked from the real client rather than re-declared: three
 * delegates, one method each, so a typed `PrismaClient` satisfies it with no
 * cast and this stays visibly SELECT and nothing else.
 */
type Delegate<Model extends keyof PrismaClient, Methods extends keyof PrismaClient[Model]> = Pick<
  PrismaClient[Model],
  Methods
>;

export type TraceDestinationReportDatabase = {
  project: Delegate<"project", "findMany">;
  organization: Delegate<"organization", "findMany">;
  virtualKey: Delegate<"virtualKey", "findMany">;
};

export class PrismaGatewayTraceDestinationReportRepository extends GatewayTraceDestinationReportRepository {
  private constructor(private readonly database: TraceDestinationReportDatabase) {
    super();
  }

  static create(options: {
    database: TraceDestinationReportDatabase;
  }): PrismaGatewayTraceDestinationReportRepository {
    return new PrismaGatewayTraceDestinationReportRepository(options.database);
  }

  async findProjects(): Promise<TraceDestinationProjectRow[]> {
    return this.database.project.findMany({
      select: PROJECT_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  async findKeyPage({
    after,
    take,
  }: {
    after: string | null;
    take: number;
  }): Promise<TraceDestinationKeyRow[]> {
    // `undefined` rather than a conditional spread — Prisma reads an absent
    // predicate exactly that way.
    return this.database.virtualKey.findMany({
      where: after === null ? undefined : { id: { gt: after } },
      select: KEY_SELECT,
      orderBy: { id: "asc" },
      take,
    });
  }

  async findOrganizationIds(): Promise<string[]> {
    const organizations = await this.database.organization.findMany({ select: { id: true } });
    return organizations.map((organization) => organization.id);
  }
}
