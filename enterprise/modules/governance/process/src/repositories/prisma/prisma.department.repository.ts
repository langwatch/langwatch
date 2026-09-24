import {
  departmentSchema,
  type Department,
  type DepartmentAssignments,
} from "@langwatch/enterprise-governance-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { type Instant, toDate } from "@langwatch/time";

import { DepartmentRepository } from "../department.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type DepartmentDatabase = Pick<
  PrismaClient,
  "department" | "departmentMembershipHistory" | "project" | "team" | "$transaction"
>;

export class PrismaDepartmentRepository extends DepartmentRepository {
  private constructor(private readonly prisma: DepartmentDatabase) {
    super();
  }

  static create(database: DepartmentDatabase): PrismaDepartmentRepository {
    return new PrismaDepartmentRepository(database);
  }

  async findAll(organizationId: string): Promise<Department[]> {
    const rows = await this.prisma.department.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => departmentSchema.parse(row));
  }

  async findById(input: { id: string; organizationId: string }): Promise<Department | null> {
    const row = await this.prisma.department.findFirst({
      where: { ...input, archivedAt: null },
    });
    return row ? departmentSchema.parse(row) : null;
  }

  async getTeamAndProjectAssignments(
    organizationId: string,
  ): Promise<Pick<DepartmentAssignments, "teams" | "projects">> {
    const [teams, projects] = await Promise.all([
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
    return { teams, projects };
  }

  async departmentsOnDay(input: {
    organizationId: string;
    userIds: readonly string[];
    dayUtc: string;
  }): Promise<Map<string, string>> {
    if (input.userIds.length === 0) return new Map();

    const dayStart = new Date(`${input.dayUtc}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const rows = await this.prisma.departmentMembershipHistory.findMany({
      where: {
        organizationId: input.organizationId,
        userId: { in: [...input.userIds] },
        validFrom: { lt: dayEnd },
        OR: [{ validTo: null }, { validTo: { gt: dayStart } }],
      },
      orderBy: { validFrom: "asc" },
      select: { userId: true, departmentId: true },
    });

    return new Map(rows.map((row) => [row.userId, row.departmentId]));
  }

  async findOpenMemberships(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string }[]> {
    if (input.userIds.length === 0) return [];
    return this.prisma.departmentMembershipHistory.findMany({
      where: { organizationId: input.organizationId, userId: { in: [...input.userIds] }, validTo: null },
      select: { userId: true, departmentId: true },
    });
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

  async recordMembership(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
    at: Instant;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const open = await tx.departmentMembershipHistory.findFirst({
        where: { organizationId: input.organizationId, userId: input.userId, validTo: null },
      });
      if (open?.departmentId === input.departmentId) return;

      const now = toDate(input.at);
      if (open) {
        await tx.departmentMembershipHistory.update({
          where: { id: open.id },
          data: { validTo: now },
        });
      }
      if (input.departmentId !== null) {
        await tx.departmentMembershipHistory.create({
          data: {
            organizationId: input.organizationId,
            userId: input.userId,
            departmentId: input.departmentId,
            validFrom: now,
          },
        });
      }
    });
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
