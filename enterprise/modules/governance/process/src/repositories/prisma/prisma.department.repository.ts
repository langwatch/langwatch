import { departmentSchema, type Department } from "@langwatch/enterprise-governance-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import { DepartmentRepository } from "../department.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type DepartmentDatabase = Pick<PrismaClient, "department">;

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
