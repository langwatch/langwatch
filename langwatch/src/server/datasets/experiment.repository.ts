import { type PrismaClient, type Experiment, type Prisma } from "@prisma/client";

/**
 * Repository layer for experiment data access.
 * Single Responsibility: Database operations for Experiment entities.
 */
export class ExperimentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Finds an experiment by id within a project.
   */
  async findExperiment(
    input: {
      id: string;
      projectId: string;
    },
    options?: {
      tx?: Prisma.TransactionClient;
    }
  ): Promise<Experiment | null> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }
}

