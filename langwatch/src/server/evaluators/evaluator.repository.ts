import type { Evaluator, Prisma, PrismaClient } from "@prisma/client";

/**
 * Input type for creating an evaluator
 */
export type CreateEvaluatorInput = {
  id: string;
  projectId: string;
  name: string;
  type: string; // "evaluator" (built-in) | "workflow" (custom)
  config: Prisma.InputJsonValue;
  workflowId?: string;
};

/**
 * Input type for updating an evaluator
 */
export type UpdateEvaluatorInput = {
  id: string;
  projectId: string;
  data: Partial<{
    name: string;
    type: string;
    config: Prisma.InputJsonValue;
    workflowId: string | null;
  }>;
};

/**
 * Repository layer for Evaluator data access.
 * Single Responsibility: Database operations for evaluators.
 */
export class EvaluatorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Finds a single evaluator by id within a project.
   * Excludes archived evaluators by default.
   */
  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<Evaluator | null> {
    return await this.prisma.evaluator.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        archivedAt: null,
      },
    });
  }

  /**
   * Finds all evaluators for a project.
   * Excludes archived evaluators. Orders by most recently updated.
   */
  async findAll(input: { projectId: string }): Promise<Evaluator[]> {
    return await this.prisma.evaluator.findMany({
      where: {
        projectId: input.projectId,
        archivedAt: null,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  /**
   * Creates a new evaluator.
   */
  async create(input: CreateEvaluatorInput): Promise<Evaluator> {
    return await this.prisma.evaluator.create({
      data: input,
    });
  }

  /**
   * Updates an existing evaluator.
   * Validates that the evaluator belongs to the specified project.
   */
  async update(input: UpdateEvaluatorInput): Promise<Evaluator> {
    return await this.prisma.evaluator.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data,
    });
  }

  /**
   * Soft deletes an evaluator by setting archivedAt.
   */
  async softDelete(input: { id: string; projectId: string }): Promise<Evaluator> {
    return await this.prisma.evaluator.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: {
        archivedAt: new Date(),
      },
    });
  }
}
