import { departmentSchema, type Department } from "@langwatch/enterprise-governance-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";

import { DepartmentRepository } from "../department.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type DepartmentDatabase = Pick<
  PrismaClient,
  "department" | "departmentMembershipHistory" | "$transaction"
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

  async recordMemberDepartment(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
    at: Instant;
  }): Promise<void> {
    const { organizationId, userId, departmentId } = input;
    await this.prisma.$transaction(async (tx) => {
      const open = await tx.departmentMembershipHistory.findFirst({
        where: { organizationId, userId, validTo: null },
      });
      if (open?.departmentId === departmentId) return;

      const at = toDate(input.at);
      if (open) {
        await tx.departmentMembershipHistory.update({
          where: { id: open.id },
          data: { validTo: at },
        });
      }
      if (departmentId !== null) {
        await tx.departmentMembershipHistory.create({
          data: { organizationId, userId, departmentId, validFrom: at },
        });
      }
    });
  }

  async findMemberDepartmentsOnDay({
    organizationId,
    userIds,
    dayUtc,
  }: {
    organizationId: string;
    userIds: readonly string[];
    dayUtc: string;
  }): Promise<{ userId: string; departmentId: string }[]> {
    if (userIds.length === 0) return [];
    const endOfDay = new Date(`${dayUtc}T23:59:59.999Z`);
    return this.prisma.departmentMembershipHistory.findMany({
      where: {
        organizationId,
        userId: { in: [...userIds] },
        validFrom: { lte: endOfDay },
        OR: [{ validTo: null }, { validTo: { gt: endOfDay } }],
      },
      select: { userId: true, departmentId: true },
    });
  }

  async findOpenMemberDepartmentLinks({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string }[]> {
    return this.prisma.departmentMembershipHistory.findMany({
      where: { organizationId, userId: { in: [...userIds] }, validTo: null },
      select: { userId: true, departmentId: true },
    });
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
