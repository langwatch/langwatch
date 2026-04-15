import type { Experiment, Prisma, PrismaClient } from "@prisma/client";

/**
 * Repository layer for experiment data access.
 * Single Responsibility: Database operations for experiments.
 */
export class ExperimentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    input: { id: string; projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment | null> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.findFirst({
      where: { id: input.id, projectId: input.projectId },
    });
  }

  async findBySlug(
    input: { slug: string; projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment | null> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.findFirst({
      where: { slug: input.slug, projectId: input.projectId },
    });
  }

  async findAll(
    input: { projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment[]> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.findMany({
      where: { projectId: input.projectId },
    });
  }

  /**
   * Finds slugs matching a prefix, used by slug deduplication.
   * Returns only slug strings for efficient in-memory filtering.
   */
  async findBySlugPrefix(input: {
    projectId: string;
    slugPrefix: string;
    excludeId?: string;
  }): Promise<Array<{ slug: string }>> {
    return await this.prisma.experiment.findMany({
      select: { slug: true },
      where: {
        projectId: input.projectId,
        slug: { startsWith: input.slugPrefix },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
    });
  }

  /**
   * Finds experiment names starting with "Draft" for draft name generation.
   */
  async findDraftNames(input: {
    projectId: string;
  }): Promise<Array<{ name: string | null; slug: string }>> {
    return await this.prisma.experiment.findMany({
      select: { name: true, slug: true },
      where: {
        projectId: input.projectId,
        name: { startsWith: "Draft" },
      },
    });
  }

  async findAllSlugs(input: {
    projectId: string;
  }): Promise<Array<{ slug: string }>> {
    return await this.prisma.experiment.findMany({
      select: { slug: true },
      where: { projectId: input.projectId },
    });
  }

  async findLatest(
    input: { projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment | null> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.findFirst({
      where: { projectId: input.projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  async upsert(
    input: {
      id: string;
      projectId: string;
      data: Prisma.ExperimentUpdateInput;
    },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.upsert({
      where: { id: input.id, projectId: input.projectId },
      update: input.data,
      create: {
        ...(input.data as Prisma.ExperimentUncheckedCreateInput),
        id: input.id,
      },
    });
  }

  async create(
    input: { data: Prisma.ExperimentUncheckedCreateInput },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.create({ data: input.data });
  }
}
