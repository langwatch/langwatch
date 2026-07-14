import type { PrismaClient, Team } from "@prisma/client";
import type {
  CreateTeamInput,
  PaginatedResult,
  TeamRepository,
  UpdateTeamInput,
} from "./team.repository";

export class PrismaTeamRepository implements TeamRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Team | null> {
    return this.prisma.team.findUnique({ where: { id } });
  }

  async findAllByOrganization({
    organizationId,
    page,
    limit,
  }: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Team>> {
    const where = { organizationId, archivedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.team.count({ where }),
    ]);
    return { data, pagination: { page, limit, total } };
  }

  async findBySlugInOrganization({
    slug,
    organizationId,
  }: {
    slug: string;
    organizationId: string;
  }): Promise<Team | null> {
    return this.prisma.team.findFirst({ where: { slug, organizationId, archivedAt: null } });
  }

  async create(data: CreateTeamInput): Promise<Team> {
    return this.prisma.team.create({ data });
  }

  async update({
    id,
    organizationId,
    data,
  }: {
    id: string;
    organizationId: string;
    data: UpdateTeamInput;
  }): Promise<Team | null> {
    const where = { id, organizationId, archivedAt: null };
    const result = await this.prisma.team.updateMany({ where, data });
    if (result.count === 0) return null;
    return this.prisma.team.findUnique({ where: { id } });
  }

  async archive({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<Team | null> {
    const where = { id, organizationId, archivedAt: null };
    const result = await this.prisma.team.updateMany({
      where,
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) return null;
    return this.prisma.team.findUnique({ where: { id } });
  }
}
