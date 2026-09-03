import {
  departmentSchema,
  type Department,
  type DepartmentAssignments,
} from "@langwatch/enterprise-governance-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { DepartmentRepository } from "../../ports/department.port";

export class PrismaDepartmentRepository extends DepartmentRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(database: object): PrismaDepartmentRepository {
    return new PrismaDepartmentRepository(database as PrismaClient);
  }

  async getAll(organizationId: string): Promise<Department[]> {
    const rows = await this.prisma.department.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => departmentSchema.parse(row));
  }

  async tryGetById(input: { id: string; organizationId: string }): Promise<Department | null> {
    const row = await this.prisma.department.findFirst({
      where: { ...input, archivedAt: null },
    });
    return row ? departmentSchema.parse(row) : null;
  }

  async getAssignments(organizationId: string): Promise<DepartmentAssignments> {
    const [members, teams, projects] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where: { organizationId },
        select: {
          userId: true,
          departmentId: true,
          user: { select: { name: true, email: true } },
        },
      }),
      this.prisma.team.findMany({
        where: { organizationId },
        select: { id: true, name: true, departmentId: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.project.findMany({
        where: { team: { organizationId } },
        select: { id: true, name: true, departmentId: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return {
      users: members
        .map((member) => ({
          id: member.userId,
          name: member.user.name ?? member.user.email ?? member.userId,
          departmentId: member.departmentId,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      teams,
      projects,
    };
  }

  async create(input: { organizationId: string; name: string }): Promise<Department> {
    return departmentSchema.parse(await this.prisma.department.create({ data: input }));
  }

  async resolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department> {
    const existing = await this.tryFindActiveByName(input);
    if (existing) return existing;
    try {
      return await this.create(input);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.tryFindActiveByName(input);
        if (winner) return winner;
      }
      throw error;
    }
  }

  async rename(input: { id: string; organizationId: string; name: string }): Promise<boolean> {
    const result = await this.prisma.department.updateMany({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        archivedAt: null,
      },
      data: { name: input.name },
    });
    return result.count > 0;
  }

  async archive(input: { id: string; organizationId: string }): Promise<boolean> {
    const result = await this.prisma.department.updateMany({
      where: input,
      data: { archivedAt: new Date() },
    });
    return result.count > 0;
  }

  async assignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    const result = await this.prisma.organizationUser.updateMany({
      where: {
        userId: input.userId,
        organizationId: input.organizationId,
      },
      data: { departmentId: input.departmentId },
    });
    return result.count > 0;
  }

  async assignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    const result = await this.prisma.team.updateMany({
      where: { id: input.teamId, organizationId: input.organizationId },
      data: { departmentId: input.departmentId },
    });
    return result.count > 0;
  }

  async assignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    const result = await this.prisma.project.updateMany({
      where: {
        id: input.projectId,
        team: { organizationId: input.organizationId },
      },
      data: { departmentId: input.departmentId },
    });
    return result.count > 0;
  }

  private async tryFindActiveByName(input: {
    organizationId: string;
    name: string;
  }): Promise<Department | null> {
    const row = await this.prisma.department.findFirst({
      where: { ...input, archivedAt: null },
    });
    return row ? departmentSchema.parse(row) : null;
  }
}
